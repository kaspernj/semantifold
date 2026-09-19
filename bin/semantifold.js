#!/usr/bin/env node
// @ts-check

import {SemantifoldCli} from "../index.js"

process.exitCode = await new SemantifoldCli().run(process.argv.slice(2))
