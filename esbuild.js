const esbuild = require("esbuild");

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const minify = args.includes("--minify");
const sourcemap = args.includes("--sourcemap") && !minify;

async function main() {
    const options = {
        entryPoints: ["src/extension.ts"],
        bundle: true,
        external: ["vscode"],
        outfile: "dist/main.js",
        platform: "node",
        format: "cjs",
        minify,
        sourcemap,
        logLevel: "info",
    };

    if (watch) {
        const ctx = await esbuild.context(options);
        await ctx.watch();
    } else {
        await esbuild.build(options);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
