# 30-template-docs

> `README.template.md` is the documentation source. `README.md` is generated
> from it and must not be edited by hand.

This example demonstrates **template-based documentation generation**: the
generated `README.md` contains no politty markers because all generated
content is expanded from the politty placeholders in this template.

{{politty:command::heading}}

{{politty:command::description}}

{{politty:command::usage}}

{{politty:command::subcommands}}

## Subcommands in detail

The sections below are fully generated from the command definitions.

{{politty:command:add}}

You can also embed single sections with typed placeholders of the form
`politty:command:<scope>:<type>` (wrapped in double curly braces). The `list`
section below intentionally omits the usage block:

{{politty:command:list:heading}}

{{politty:command:list:description}}

{{politty:command:list:options}}

## Closing notes

Handwritten content can appear anywhere around the placeholders, before and
after generated sections.
