#!/usr/bin/env node
import { main } from '../src/commands.js';

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (error) => {
    console.error(`jump: ${error.message}`);
    process.exit(1);
  },
);
