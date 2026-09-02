// @ts-check

import {rm} from "node:fs/promises"

await rm(new URL("../build", import.meta.url), {force: true, recursive: true})
