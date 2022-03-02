# clang-format-checker

## Features

clang-format-checker is a Visual Studio Code extenasion that runs clang-format tools to check code formatting issues. All clang-format
reported issues are highlihted providing a brief description of the issue. Note that clang-format itself does not provide any description.
The extension tries to do a best-effort to guess what is the issue. In addition, the extension implements "Quick Fix" feature.

Check can be initiated via command or context-menu (look for `Clang-format Checker` command/menu), or triggered on editor change (must be enabled in settings).

## Requirements

clang-format must be installed on your system and path to the exectutable must be provided in the settings (or added to the system path).

## Extension Settings

This extension contributes the following settings:

* `clang-format-checker.checkOnChange`: check code as you type (requires reload)
* `clang-format-checker.clangFormatExecutable`: path to clang-format executable