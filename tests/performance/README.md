# Runtime benchmarks

Run `pnpm bench` from the repository root with Node 24 or newer. It builds the workspace first, then measures shared argument parsing plus Zod, Valibot and Loculus
schema extraction with a warm cache, subcommand execution with validation, help
generation, and static/dispatcher completion generation for Bash, Zsh, and Fish. The fixtures
exercise positional arguments, aliases, repeated array options, numeric coercion,
and subcommand routing. Both adapters use equivalent five-field schemas and the same command tree and argv.
Assertions check parsing, coercion, defaults, invalid enum and non-finite number rejection, command results,
help, and completion generation before measurement. Each source adapter is registered once
before its scenarios run; adapter switching is excluded from timing. The shared parser
is measured once because it consumes adapter-neutral parser options.

Existing Zod metric keys and workloads are preserved. The nine additional Valibot
metrics have no comparison until the first main CI run containing them stores a baseline.

Loculus runs in separate Node processes against two otherwise identical CLI bundles:
one without the plugin and one using the default `@loculus/rolldown` optimization.
Both use the published adapter's built output, the same five-field schema, strip
unknown keys, and the same command tree and argv as the other adapters. The benchmark
checks that the plugin actually specializes the fixture. Schema construction,
bundling, adapter registration and fixture assertions are outside runtime timing.
Loculus metrics include the bundle variant in their keys and labels. These are
warm runtime comparisons; Zod and Valibot use source modules, so they do not compare
process startup or published bundle sizes against Loculus.

Loculus additionally measures its native Standard Schema validator with the same
already-constructed raw argument object before and after optimization. This isolates
validator specialization from Politty's parser and runner overhead. Command execution
metrics for all adapters measure the full Politty execution path with validation.

Each scenario warms up for 300 ms, then records seven samples of at least 250 ms
each in batches of 100 operations. The reported value is the median time per
operation in nanoseconds (`ns/op`). Fixtures are constructed outside the timed
region; import/startup time and user command I/O are excluded. Completion measures
script generation, not the shell executing the script. An explicit fixture binary
path avoids dependence on the runner's PATH lookup. Results and sample ranges
are printed, and `benchmark-results/octocov.json` contains the octocov metrics.

Loculus also reports raw and gzip-compressed fixture bundle bytes. The fixture
exports the APIs needed for the runtime measurements; its size is not a minimal
production CLI size. The measurement driver is a separate artifact and is excluded
from bundle size and startup timing. Startup launches the bundled CLI in a fresh
Node process and measures process creation, module loading, schema/command
construction and the first successful subcommand execution. Node's compile cache
is disabled. Each variant has two warmup launches, followed by nine measured
launches, with the variants' order alternating. The median and range are reported
in milliseconds. This is a fresh process with warmed OS file caches, not a cold
filesystem measurement. Temporary bundles, driver and cache directory are removed
after measurement, including on failure.

Linux CI runs the benchmarks after the other checks finish and passes the JSON
to [octocov custom metrics](https://github.com/k1LoW/octocov#custom-metrics).
The existing main-branch artifact is the baseline. PR bodies and Actions job
summaries show the current values and differences: negative differences mean
improvement, positive differences mean regression. Fork PRs can view the job
summary even when their token cannot edit the PR body.

The first main CI run containing these benchmarks establishes the baseline;
until then only current values are available. Comparisons use the PR's base-branch
report when available, falling back to main. This workflow stores reports only
for main, so its PR benchmarks use main as the baseline.
Runner hardware, load, Node.js, and dependency
changes can affect timing, so small differences should be confirmed with repeated
runs on the same machine. No regression threshold fails CI. The new Loculus keys
acquire a main comparison baseline after merging. If fixture workloads
or measurement methodology change, bump the metrics group key in `run.ts` to
avoid comparing unlike measurements.
