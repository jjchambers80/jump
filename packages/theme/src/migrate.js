// Stored documents are upgraded on read (spec 038 D14): section code is
// shared and always current, so there is no "update theme" button. Unknown
// section or block types (removed from the registry) are dropped and
// reported so the caller can log them.

import { BLOCKS, SECTIONS } from './registry.js';
import { SCHEMA_VERSION } from './limits.js';

/**
 * @param {object} data     stored Puck data
 * @param {number} version  the row's schemaVersion
 * @returns {{ data: object, dropped: string[], schemaVersion: number }}
 */
export function migrateDocument(data, version = SCHEMA_VERSION) {
  const dropped = [];
  // v1 is the first format; future steps go here: if (version < 2) { … }
  void version;
  const keepBlocks = (blocks) =>
    Array.isArray(blocks)
      ? blocks.filter((b) => (BLOCKS[b?.type] ? true : (dropped.push(String(b?.type)), false)))
      : blocks;
  const content = Array.isArray(data?.content)
    ? data.content
        .filter((s) => (SECTIONS[s?.type] ? true : (dropped.push(String(s?.type)), false)))
        .map((s) => (s.props?.blocks ? { ...s, props: { ...s.props, blocks: keepBlocks(s.props.blocks) } } : s))
    : [];
  return { data: { root: data?.root ?? { props: {} }, content }, dropped, schemaVersion: SCHEMA_VERSION };
}
