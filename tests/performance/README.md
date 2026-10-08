# Runtime benchmarks

Run `pnpm bench` from the repository root. It measures argument parsing, Zod
schema extraction with a warm cache, subcommand execution with validation, help
generation, and static/dispatcher completion generation for Bash, Zsh, and Fish. The fixtures
exercise positional arguments, aliases, repeated array options, numeric coercion,
and subcommand routing. Assertions check fixture behavior before measurement.

Each scenario warms up for 300 ms, then records seven samples of at least 250 ms
each in batches of 100 operations. The reported value is the median time per
operation in nanoseconds (`ns/op`). Fixtures are constructed outside the timed
region; import/startup time and user command I/O are excluded. Completion measures
script generation, not the shell executing the script. An explicit fixture binary
path avoids dependence on the runner's PATH lookup. Results and sample ranges
are printed, and `benchmark-results/octocov.json` contains the octocov metrics.

Linux CI runs the benchmarks after the other checks finish and passes the JSON
to [octocov custom metrics](https://github.com/k1LoW/octocov#custom-metrics).
The existing main-branch artifact is the baseline. PR bodies and Actions job
summaries show the current values and differences: negative differences mean
improvement, positive differences mean regression. Fork PRs can view the job
summary even when their token cannot edit the PR body.

The first main CI run containing these benchmarks establishes the baseline;
until then only current values are available. Comparisons use main, including for
PRs targeting another branch. Runner hardware, load, Node.js, and dependency
changes can affect timing, so small differences should be confirmed with repeated
runs on the same machine. No regression threshold fails CI. If fixture workloads
or measurement methodology change, bump the metrics group key in `run.ts` to
avoid comparing unlike measurements.
