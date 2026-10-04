// The only import site of the Puck editor (spec 038 D1, contracts C12).
// Pinned to exactly 0.23.0 in package.json; the storefront imports only
// `@puckeditor/core/rsc` (server Render), never this module.

export { Puck, blocksPlugin, usePuck, createUsePuck } from '@puckeditor/core';
export type { Config, Data, Field, Fields, Plugin, CustomField } from '@puckeditor/core';
import '@puckeditor/core/puck.css';
