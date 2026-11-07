import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pin = JSON.parse(readFileSync(path.join(root, "options-compilers.json"), "utf8"));
const cache = path.join(root, ".toolchains");

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { stdio: "inherit", ...options });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
    }
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map((key) => [key, canonical(value[key])]),
        );
    }
    return value;
}

function withoutTimestamp(artifact) {
    const copy = { ...artifact };
    delete copy.updatedAt;
    return canonical(copy);
}

function releaseAsset(tag) {
    const names = {
        "linux-x64": `arkade-compiler-${tag}-x86_64-unknown-linux-musl.tar.gz`,
        "linux-arm64": `arkade-compiler-${tag}-aarch64-unknown-linux-musl.tar.gz`,
        "darwin-arm64": `arkade-compiler-${tag}-aarch64-apple-darwin.tar.gz`,
        "darwin-x64": `arkade-compiler-${tag}-x86_64-apple-darwin.tar.gz`,
        "win32-x64": `arkade-compiler-${tag}-x86_64-pc-windows-msvc.zip`,
    };
    const name = names[`${process.platform}-${process.arch}`];
    if (!name) {
        throw new Error(`no published arkadec build for ${process.platform}-${process.arch}`);
    }
    return name;
}

async function downloadRelease(tag) {
    const asset = releaseAsset(tag);
    const binaryName = process.platform === "win32" ? "arkadec.exe" : "arkadec";
    const dir = path.join(cache, `release-${tag}`);
    const binary = path.join(dir, binaryName);
    if (existsSync(binary)) return binary;

    mkdirSync(dir, { recursive: true });
    const base = `https://github.com/arkade-os/compiler/releases/download/${tag}`;
    const archive = path.join(dir, asset);
    const archiveResponse = await fetch(`${base}/${asset}`);
    if (!archiveResponse.ok) {
        throw new Error(`download ${asset} returned ${archiveResponse.status}`);
    }
    const archiveBytes = Buffer.from(await archiveResponse.arrayBuffer());
    if (archiveBytes.length < 1000) {
        throw new Error(`release asset ${asset} downloaded ${archiveBytes.length} bytes`);
    }
    const sumsResponse = await fetch(`${base}/SHA256SUMS`);
    if (!sumsResponse.ok) throw new Error(`SHA256SUMS returned ${sumsResponse.status}`);
    const sums = await sumsResponse.text();
    const expected = sums
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.endsWith(asset))
        ?.slice(0, 64);
    const actual = createHash("sha256").update(archiveBytes).digest("hex");
    if (!expected || expected !== actual) {
        throw new Error(`${asset} sha256 ${actual} does not match ${expected}`);
    }
    writeFileSync(archive, archiveBytes);
    if (asset.endsWith(".zip")) {
        run("unzip", ["-q", archive, "-d", dir]);
    } else {
        run("tar", ["-xzf", archive, "-C", dir]);
    }
    const found = findFile(dir, binaryName);
    if (!found) throw new Error(`arkadec is missing from ${asset}`);
    if (found !== binary) cpSync(found, binary);
    chmodSync(binary, 0o755);
    return binary;
}

function findFile(directory, name) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            const nested = findFile(full, name);
            if (nested) return nested;
        } else if (entry.name === name) {
            return full;
        }
    }
    return null;
}

function buildFromSource(commit, lock) {
    const lockBytes = readFileSync(path.join(root, lock));
    const lockHash = createHash("sha256").update(lockBytes).digest("hex").slice(0, 12);
    const dir = path.join(cache, `${commit}-${lockHash}`);
    const binary = path.join(dir, "target", "release", "arkadec");
    if (existsSync(binary)) return binary;

    mkdirSync(path.dirname(dir), { recursive: true });
    if (!existsSync(path.join(dir, ".git"))) {
        run("git", ["clone", "--filter=blob:none", pin.repository, dir]);
    }
    run("git", ["checkout", "--force", commit], { cwd: dir });
    writeFileSync(path.join(dir, "Cargo.lock"), lockBytes);
    const rustup = spawnSync("rustup", ["run", "stable", "cargo", "--version"], { stdio: "ignore" });
    if (rustup.status === 0) {
        run(
            "rustup",
            ["run", "stable", "cargo", "build", "--release", "--locked", "--bin", "arkadec"],
            { cwd: dir },
        );
    } else {
        run("cargo", ["build", "--release", "--locked", "--bin", "arkadec"], { cwd: dir });
    }
    return binary;
}

const compilers = new Map();

async function arkadecFor(commit) {
    if (compilers.has(commit)) return compilers.get(commit);
    const spec = pin.compilers[commit];
    if (!spec) throw new Error(`no compiler pin for ${commit}`);
    const binary = spec.release
        ? await downloadRelease(spec.release)
        : buildFromSource(commit, spec.lock);
    compilers.set(commit, binary);
    return binary;
}

function compile(binary, artifact) {
    const directory = mkdtempSync(path.join(tmpdir(), "arkade-artifact-"));
    try {
        for (const [name, text] of Object.entries(artifact.source.files)) {
            const file = path.join(directory, name);
            mkdirSync(path.dirname(file), { recursive: true });
            writeFileSync(file, text);
        }
        const output = path.join(directory, "out.json");
        const result = spawnSync(binary, [path.join(directory, artifact.source.entry), "-o", output], {
            encoding: "utf8",
        });
        if (result.status !== 0) {
            throw new Error(result.stderr || result.stdout || `${binary} exited ${result.status}`);
        }
        return JSON.parse(readFileSync(output, "utf8"));
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

const optionsDir = path.join(cache, "arkade-options");
if (!existsSync(path.join(optionsDir, ".git"))) {
    run("git", ["clone", "--depth", "1", pin.options, optionsDir]);
} else {
    run("git", ["fetch", "--depth", "1", "origin", "HEAD"], { cwd: optionsDir });
    run("git", ["checkout", "--force", "FETCH_HEAD"], { cwd: optionsDir });
}
const optionsRev = spawnSync("git", ["rev-parse", "HEAD"], { cwd: optionsDir, encoding: "utf8" });
console.log(`arkade-options ${optionsRev.stdout.trim()}`);

let failed = 0;
for (const [file, commit] of Object.entries(pin.artifacts)) {
    const committed = JSON.parse(readFileSync(path.join(optionsDir, "contracts", file), "utf8"));
    const built = compile(await arkadecFor(commit), committed);
    const match =
        JSON.stringify(withoutTimestamp(built)) === JSON.stringify(withoutTimestamp(committed));
    if (!match || (committed.fingerprint && built.fingerprint !== committed.fingerprint)) {
        failed += 1;
        console.error(
            `${file} differs from ${commit}`,
            committed.fingerprint ?? "",
            built.fingerprint ?? "",
        );
        continue;
    }
    console.log(`${file} ${commit.slice(0, 12)} ${committed.fingerprint ?? "json"}`);
}

if (failed > 0) process.exit(1);
