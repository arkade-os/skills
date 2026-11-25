// Runs a template through executord's own engine, with no executor and no network:
//
//	go run . [-server <hex>] [-emulator <hex>] <template.json> <delegation.json|-> <artifact.json>...
//
// It prints the ids the executor will return, and, given a delegation, the script each input
// resolves to. Pass the serverPubkey and emulatorPubkey of the executor's /v1/info to get the
// scripts of that network; the ids do not depend on them.
package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/arkade-os/executor/pkg/template"
	"github.com/arkade-os/executor/pkg/template/artifact"
	"github.com/btcsuite/btcd/btcec/v2"
)

type report struct {
	Artifacts map[string]string `json:"artifacts"`
	Template  string            `json:"template,omitempty"`
	Type      string            `json:"type,omitempty"`
	Inputs    []input           `json:"inputs,omitempty"`
}

type input struct {
	Name     string `json:"name"`
	Script   string `json:"script"`
	Locktime uint32 `json:"locktime,omitempty"`
}

func main() {
	server := flag.String("server", "", "serverPubkey of /v1/info, 33 bytes hex")
	emulator := flag.String("emulator", "", "emulatorPubkey of /v1/info, 33 bytes hex")
	flag.Parse()
	if flag.NArg() < 3 {
		fail("usage: check [-server hex] [-emulator hex] <template> <delegation|-> <artifact>...")
	}
	r, err := check(flag.Arg(0), flag.Arg(1), flag.Args()[2:], *server, *emulator)
	out, _ := json.MarshalIndent(r, "", "  ")
	fmt.Println(string(out))
	if err != nil {
		fail(err.Error())
	}
}

func check(tmplPath, delegationPath string, artifacts []string, server, emulator string) (*report, error) {
	r := &report{Artifacts: map[string]string{}}
	docs := map[string][]byte{}
	for _, p := range artifacts {
		raw, err := os.ReadFile(p)
		if err != nil {
			return r, err
		}
		a, err := artifact.Parse(raw)
		if err != nil {
			return r, fmt.Errorf("%s: %w", p, err)
		}
		docs[a.ID()], r.Artifacts[p] = raw, a.ID()
	}
	raw, err := os.ReadFile(tmplPath)
	if err != nil {
		return r, err
	}
	tmpl, err := template.Parse(raw, docs)
	if err != nil {
		return r, err
	}
	r.Template, r.Type = tmpl.ID(), string(tmpl.Type())
	if delegationPath == "-" {
		return r, nil
	}
	var d struct {
		Variables map[string]string `json:"variables"`
	}
	if raw, err = os.ReadFile(delegationPath); err != nil {
		return r, err
	}
	if err = json.Unmarshal(raw, &d); err != nil {
		return r, err
	}
	vars := map[string][]byte{}
	for name, v := range d.Variables {
		if vars[name], err = hex.DecodeString(v); err != nil {
			return r, fmt.Errorf("variable %q is not hex: %q", name, v)
		}
	}
	keys := template.Keys{Cosigner: placeholder(3)}
	if keys.Server, err = key(server, 1); err != nil {
		return r, err
	}
	if keys.Emulator, err = key(emulator, 2); err != nil {
		return r, err
	}
	inst, err := tmpl.Instantiate(template.Context{Keys: keys, Variables: vars})
	if err != nil {
		return r, err
	}
	for slot, s := range tmpl.Inputs() {
		in := input{Name: s.Name, Script: hex.EncodeToString(inst.PkScript(slot))}
		if lt, ok := inst.Locktime(slot); ok {
			in.Locktime = uint32(lt)
		}
		r.Inputs = append(r.Inputs, in)
	}
	return r, nil
}

func key(given string, seed byte) (*btcec.PublicKey, error) {
	if given == "" {
		return placeholder(seed), nil
	}
	raw, err := hex.DecodeString(given)
	if err != nil {
		return nil, err
	}
	return btcec.ParsePubKey(raw)
}

func placeholder(seed byte) *btcec.PublicKey {
	_, pub := btcec.PrivKeyFromBytes([]byte{31: seed})
	return pub
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
