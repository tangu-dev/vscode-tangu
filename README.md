# VSCode Tangu Language Extension

A Visual Studio Code (VSCode) extension for the Tangu language.

## Setup

```sh
cd tangu-language-server
cargo r
```

```sh
npm i
```

Compile:

```sh
npm run compile
```

Package as VSIX:

```sh
npm run package
```

or

```sh
vsce package
```

> #Tip: If you only change non-ts files, no need to run compile.

To install, go to the VSCode extensions sidebar and select
`Install Extension VSIX` from the overflow menu (3 dots menu), top-right.

Make sure the latest version of tangu-language-server is installed:

```sh
cargo install tangu-language-server
```

To publish the extension to the Marketplace, run:

```sh
npm run publish
```

## Setup

```sh
cargo install tangu-language-server
```

## Logging

In the VSCode Output panel there are various Tangu-related logging sinks:

- `Tangu Language`: tangu-language-server error logs (`eprintln!`)
- `Tangu Language Server Trace`: ??
- `Tangu Language Client`: show logs appended to the clientOutputChannel (_not_
  console.log etc)
- `Extension Host`: shows extension activation errors.

## Customizing Syntax Highlighting

The extension provides semantic token highlighting for Tangu code. You can
customize the styling in your VS Code `settings.json`.

### Mutable Variables

By default, mutable variables (declared with `#var`) are displayed with an
underline. To customize this:

```json
{
    "editor.semanticTokenColorCustomizations": {
        "rules": {
            "*.modification": {
                "fontStyle": "underline",
                "foreground": "#ff6600"
            }
        }
    }
}
```

Available `fontStyle` options: `"bold"`, `"italic"`, `"underline"`,
`"strikethrough"`, or combinations like `"bold underline"`.

To disable the underline for mutable variables:

```json
{
    "editor.semanticTokenColorCustomizations": {
        "rules": {
            "*.modification": {
                "fontStyle": ""
            }
        }
    }
}
```

### Theme-Specific Customization

You can also customize styling per theme:

```json
{
    "editor.semanticTokenColorCustomizations": {
        "[One Dark Pro]": {
            "rules": {
                "*.modification": {
                    "fontStyle": "italic underline"
                }
            }
        },
        "[Default Light+]": {
            "rules": {
                "*.modification": {
                    "foreground": "#d63200"
                }
            }
        }
    }
}
```

## Status

This is an _experimental_ project, not intended for production use.

## Contributing

Pull requests, issues, and comments are welcome! Make sure to add tests for new
features and bug fixes.

## License

This work is licensed under the Apache-2.0 License. See
[LICENSE.txt](LICENSE.txt) or <https://spdx.org/licenses/Apache-2.0.html> for
details.

## Copyright

Copyright © 2022 [Georgios Moschovitis](https://gmosx.com).
