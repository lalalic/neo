#!/bin/sh
# Compatibility entrypoint; the installed native Harness owns setup.
set -eu
exec neo setup code-tools
