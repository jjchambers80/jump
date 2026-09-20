// Resolve a public URL segment by its canonical slug while retaining legacy id
// compatibility. IDs win if an old id happens to equal another record's slug.

export async function findByPublicIdentifier(
  delegate,
  identifier,
  { slugField = 'slug', where = {}, ...query } = {}
) {
  const byId = await delegate.findFirst({
    ...query,
    where: { ...where, id: identifier },
  });
  if (byId) return byId;
  return delegate.findFirst({
    ...query,
    where: { ...where, [slugField]: identifier },
  });
}
