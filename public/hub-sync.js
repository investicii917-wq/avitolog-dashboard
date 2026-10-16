export function mergeManifest(remote, rows, deletedIds = []) {
 const deleted = new Set([...(remote?.deletedListingIds || []), ...deletedIds]);
 const entries = new Map((remote?.listings || []).map(row => [row.listingId, row]));
 for (const row of rows) {
  const old = entries.get(row.listingId);
  if (!old || (Date.parse(row.updatedAt) || 0) >= (Date.parse(old.updatedAt) || 0)) entries.set(row.listingId, row);
 }
 for (const id of deleted) entries.delete(id);
 return {...remote, schema:'avitolog.hub.v1', schemaVersion:1, revision:(remote?.revision || 0) + 1,
  updatedAt:new Date().toISOString(), deletedListingIds:[...deleted], listings:[...entries.values()]};
}
export function retainPendingState(remote, local) {
 const deleted = new Set([...(remote.deletedMailboxItemIds || []), ...(local.deletedMailboxItemIds || [])]);
 const pending = (local.outbox || []).filter(task => !task.deliveredAt);
 const pendingIds = new Set(pending.map(task => task.markers?.listingId || task.payload?.itemId || task.payload?.item?.id));
 const items = new Map(remote.items.map(record => [record.id, record]));
 for (const record of local.items || []) {
  const row = items.get(record.id);
  if (pendingIds.has(record.id) || (row && record.itemLoaded !== false && (Date.parse(record.updatedAt)||0) >= (Date.parse(row.updatedAt)||0))) items.set(record.id, record);
 }
 return {...remote, items:[...items.values()].filter(record => !deleted.has(record.id)),
  outbox:(local.outbox || []).filter(task=>!deleted.has(task.markers?.listingId||task.payload?.itemId||task.payload?.item?.id)), newDraft:local.newDraft || null,
  deletedMailboxItemIds:[...deleted], processedMailboxResults:local.processedMailboxResults || [],
  importedMailboxInbox:local.importedMailboxInbox || [],
  ...(pending.some(task => task.type?.startsWith('calendar.')) ? {slots:local.slots, bookings:local.bookings} : {})};
}
