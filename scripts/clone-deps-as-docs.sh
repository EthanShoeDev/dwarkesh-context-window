#!/usr/bin/env bash

mkdir -p docs/cloned-repos-as-docs

cd docs/cloned-repos-as-docs

gh repo clone Effect-TS/effect
gh repo clone Effect-TS/website
gh repo clone amishshah/prism-media
gh repo clone eugeneware/ffmpeg-static
gh repo clone floydspace/effect-aws