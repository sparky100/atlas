import { useCallback, useEffect, useState } from 'react';
import { SECTORS, capabilityMapContentSchema, type CapabilityMapContent } from '../../contracts/capabilityMapContent';
import { alignDraftItem, copyReferenceMap, createReferenceMapDraft, listDraftAlignments, listReferenceMaps, publishReferenceMapDraft, readReferenceMap, saveReferenceMapDraft, searchCanonicalCapabilities, validateReferenceMap, type CanonicalCapabilityMatch, type DraftAlignment, type ReferenceMapDraft, type ReferenceMapSummary } from '../../db/referenceMapAdmin';
import { SettingsSection } from '../components/SettingsSection/SettingsSection';
import { supabase } from '../supabaseClient';
import styles from './ReferenceMapAdmin.module.css';

type Item = CapabilityMapContent['items'][number];
type Stream = CapabilityMapContent['valueStreams'][number];
type Stage = Stream['stages'][number];

function treeOrder(items: Item[]): Item[] {
  const result: Item[] = [];
  const visited = new Set<string>();
  function visit(parent: string | null) {
    for (const item of items.filter((candidate) => candidate.parentCode === parent).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))) {
      if (visited.has(item.code)) continue;
      visited.add(item.code); result.push(item); visit(item.code);
    }
  }
  visit(null);
  return [...result, ...items.filter((item) => !visited.has(item.code))];
}

export function ReferenceMapAdmin() {
  const [maps, setMaps] = useState<ReferenceMapSummary[]>([]);
  const [drafts, setDrafts] = useState<ReferenceMapDraft[]>([]);
  const [draft, setDraft] = useState<ReferenceMapDraft | null>(null);
  const [baseContent, setBaseContent] = useState<CapabilityMapContent | null>(null);
  const [alignments, setAlignments] = useState<DraftAlignment[]>([]);
  const [identitySearch, setIdentitySearch] = useState('');
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const [matches, setMatches] = useState<CanonicalCapabilityMatch[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newDefinition, setNewDefinition] = useState('');
  const [reviewBasis, setReviewBasis] = useState('');
  const [content, setContent] = useState<CapabilityMapContent | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [preview, setPreview] = useState<{ map: ReferenceMapSummary; content: CapabilityMapContent } | null>(null);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [previewFilter, setPreviewFilter] = useState('');
  const [sector, setSector] = useState<string>(SECTORS[0]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[] | null>(null);

  const refresh = useCallback(async () => {
    const result = await listReferenceMaps(supabase);
    setMaps(result.maps);
    setDrafts(result.drafts);
    return result;
  }, []);
  useEffect(() => { void Promise.resolve().then(refresh).catch((cause: unknown) => { setError(String(cause)); }); }, [refresh]);

  const current = maps.find((m) => m.sector === sector && m.status === 'published');
  const sectorMaps = maps.filter((m) => m.sector === sector).sort((a, b) => b.version - a.version);
  const nextVersion = Math.max(0, ...maps.filter((m) => m.sector === sector).map((m) => m.version), ...drafts.filter((d) => d.sector === sector).map((d) => d.version)) + 1;
  const dirty = draft !== null && content !== null && JSON.stringify(content) !== JSON.stringify(draft.content);
  const selected = content?.items.find((i) => i.code === selectedCode);
  const selectedAlignment = alignments.find((alignment) => alignment.item_code === selectedCode);
  const selectedAligned = selected !== undefined && selectedAlignment?.reviewed_name === selected.name
    && selectedAlignment.reviewed_description === (selected.description ?? '');

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const change = (next: CapabilityMapContent) => { setContent(next); setIssues(null); };
  const openDraft = (entry: ReferenceMapDraft) => void run(async () => {
    const base = maps.find((map) => map.id === entry.base_map_id);
    setBaseContent(base ? await copyReferenceMap(supabase, base) : null);
    setAlignments(await listDraftAlignments(supabase, entry.id));
    setDraft(entry); setContent(entry.content); setSelectedCode(null); setIssues(null); setSector(entry.sector);
  });
  const updateItem = (code: string, patch: Partial<Item>) => {
    if (!content) return;
    change({ ...content, items: content.items.map((item) => item.code === code ? { ...item, ...patch } : item) });
    if (patch.code !== undefined) setSelectedCode(patch.code);
  };
  const updateStream = (index: number, patch: Partial<Stream>) => {
    if (!content) return;
    change({ ...content, valueStreams: content.valueStreams.map((stream, n) => n === index ? { ...stream, ...patch } : stream) });
  };
  const updateStage = (streamIndex: number, stageIndex: number, patch: Partial<Stage>) => {
    if (!content) return;
    change({ ...content, valueStreams: content.valueStreams.map((stream, n) => n === streamIndex
      ? { ...stream, stages: stream.stages.map((stage, m) => m === stageIndex ? { ...stage, ...patch } : stage) } : stream) });
  };

  const start = () => void run(async () => {
    const base = current ?? null;
    const initial: CapabilityMapContent = base ? { ...await copyReferenceMap(supabase, base), version: nextVersion } : {
      sector: sector as CapabilityMapContent['sector'], version: nextVersion, status: 'draft',
      title: '', summary: '', sourceDescription: '', sources: [], items: [], valueStreams: [],
    };
    const id = await createReferenceMapDraft(supabase, sector, nextVersion, base?.id ?? null, initial);
    const result = await refresh();
    const created = result.drafts.find((entry) => entry.id === id);
    if (!created) throw new Error('Draft created, but could not be loaded. Reload the page.');
    setBaseContent(base ? initial : null);
    setAlignments(await listDraftAlignments(supabase, id));
    setDraft(created); setContent(created.content); setSelectedCode(null); setIssues(null);
    setNotice(`${sector} v${String(nextVersion)} draft created. Existing models will not change when it is published.`);
  });

  const viewMap = (map: ReferenceMapSummary) => void run(async () => {
    const loaded = await readReferenceMap(supabase, map);
    setPreview({ map, content: loaded }); setPreviewCode(null); setPreviewFilter('');
  });

  const save = () => void run(async () => {
    if (!draft || !content) return;
    const revision = await saveReferenceMapDraft(supabase, draft, content);
    setDraft({ ...draft, content, edit_revision: revision });
    await refresh(); setNotice(`Draft saved (revision ${String(revision)}).`);
  });

  const validate = () => void run(async () => {
    if (!content) return;
    const local = capabilityMapContentSchema.safeParse(content);
    const localIssues = local.success ? [] : local.error.issues.map((issue) => `${issue.path.join('.') || 'Map'}: ${issue.message}`);
    const serverIssues = await validateReferenceMap(supabase, content);
    const missing = content.items.filter((item) => !alignments.some((alignment) => alignment.item_code === item.code
      && alignment.reviewed_name === item.name && alignment.reviewed_description === (item.description ?? '')));
    const identityIssues = missing.length ? [`Review the canonical identity for ${String(missing.length)} capabilities. Select each item in the tree to use an existing identity or create one.`] : [];
    setIssues([...localIssues, ...serverIssues, ...identityIssues]);
    setNotice(localIssues.length + serverIssues.length + identityIssues.length === 0 ? 'Ready for publication. Review the comparison and save before publishing.' : 'Resolve the issues shown below.');
  });

  const publish = () => void run(async () => {
    if (!draft || !content || dirty || !issues || issues.length) return;
    const id = await publishReferenceMapDraft(supabase, draft);
    await refresh(); setDraft(null); setContent(null); setBaseContent(null); setAlignments([]); setSelectedCode(null); setIssues(null); setPreview(null);
    setNotice(`Published ${draft.sector} v${String(draft.version)}. Existing seeded models remain unchanged. Map ID: ${id}`);
  });

  const findIdentity = () => void run(async () => {
    setMatches(await searchCanonicalCapabilities(supabase, identitySearch));
    setSearchedFor(identitySearch);
  });

  const align = (choice: { kind: 'existing'; capabilityId: string; revision: number; reviewBasis: string }
    | { kind: 'new'; stableKey: string; definition: string; reviewBasis: string }) => void run(async () => {
    if (!draft || !selected || dirty) return;
    const revision = await alignDraftItem(supabase, draft, selected.code, choice);
    setDraft({ ...draft, edit_revision: revision });
    setAlignments(await listDraftAlignments(supabase, draft.id));
    await refresh(); setIssues(null); setNotice(`Identity reviewed for ${selected.name}. Validate again before publishing.`);
  });

  return <SettingsSection id="capability-sets" title="Capability sets" summary={`${String(maps.filter((m) => m.status === 'published').length)} published · ${String(drafts.filter((d) => d.status === 'draft').length)} drafts`}>
    <p>Manage platform starter maps here. A draft stays private to platform admins until publication. Publishing creates a new fixed version; it does not update models already seeded from an earlier version.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className={styles.controls}>
      <label>Sector <select value={sector} onChange={(e) => { setSector(e.target.value); setPreview(null); }} disabled={busy}>{SECTORS.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
      <span>{current ? `Current: ${current.title ?? current.sector} v${String(current.version)}` : 'No published map'}</span>
      {current && <button type="button" onClick={() => { viewMap(current); }} disabled={busy}>View current set</button>}
      <button type="button" onClick={start} disabled={busy || drafts.some((d) => d.sector === sector && d.status === 'draft')}>Create v{nextVersion} draft{current ? ' from current' : ''}</button>
    </div>
    <details><summary>Versions for {sector.replaceAll('_', ' ')} ({sectorMaps.length})</summary>
      <div className={styles.cards}>{sectorMaps.map((map) => <div className={styles.itemCard} key={map.id}>
        <strong>{map.title ?? map.sector} · v{map.version}</strong>
        <span>{map.status === 'published' ? 'Current published version' : map.status}</span>
        <span>{map.item_count} capabilities · {map.seeded_model_count} models seeded</span>
        <span>{map.published_at ? `Published ${new Date(map.published_at).toLocaleDateString('en-GB')}` : 'Not published'}</span>
        <button type="button" onClick={() => { viewMap(map); }} disabled={busy}>View v{map.version} contents</button>
      </div>)}</div>
    </details>
    {preview && <section className={styles.preview} aria-label="Capability set contents">
      <div className={styles.previewHeader}>
        <div><h3>{preview.content.title} · v{preview.map.version}</h3><p>{preview.map.sector.replaceAll('_', ' ')} · {preview.map.status} · {preview.content.items.length} capabilities · {preview.content.valueStreams.length} value streams · {preview.map.seeded_model_count} seeded models</p></div>
        <button type="button" onClick={() => { setPreview(null); }}>Close view</button>
      </div>
      <p>{preview.content.summary}</p>
      <div className={styles.previewGrid}>
        <div className={styles.tree}>
          <label>Find in this set <input value={previewFilter} onChange={(e) => { setPreviewFilter(e.target.value); }} placeholder="Capability name or code" /></label>
          <div className={styles.scroll} role="group" aria-label="Capabilities in this set">
            {treeOrder(preview.content.items).filter((item) => `${item.name} ${item.code}`.toLowerCase().includes(previewFilter.toLowerCase())).map((item) =>
              <button type="button" key={item.code} className={previewCode === item.code ? styles.active : ''} style={{ paddingLeft: `${String(8 + (item.level - 1) * 14)}px` }} onClick={() => { setPreviewCode(item.code); }}>
                {item.name} <small>{item.code} · level {item.level}</small>
              </button>)}
            {previewFilter && !preview.content.items.some((item) => `${item.name} ${item.code}`.toLowerCase().includes(previewFilter.toLowerCase())) && <p>No matching capabilities.</p>}
          </div>
        </div>
        <div className={styles.itemCard}>
          {previewCode ? (() => {
            const item = preview.content.items.find((candidate) => candidate.code === previewCode);
            if (!item) return null;
            const parent = preview.content.items.find((candidate) => candidate.code === item.parentCode);
            return <><h4>{item.name}</h4><p>{parent ? `Under ${parent.name}` : 'Top level'} · {item.code}</p><p>{item.description?.trim() ? item.description : 'No definition recorded.'}</p></>;
          })() : <p>Select a capability to read its definition and place in the set.</p>}
        </div>
      </div>
      <details><summary>Value streams ({preview.content.valueStreams.length})</summary>
        <div className={styles.cards}>{[...preview.content.valueStreams].sort((a, b) => a.order - b.order).map((stream) => <details className={styles.itemCard} key={stream.code}>
          <summary>{stream.name} · {stream.stages.length} stages</summary>
          {stream.description && <p>{stream.description}</p>}
          <ol>{[...stream.stages].sort((a, b) => a.order - b.order).map((stage) => <li key={stage.code}><strong>{stage.name}</strong>{stage.description && <p>{stage.description}</p>}<small>Enabled by: {stage.enables.join(', ') || 'No capabilities recorded'}</small></li>)}</ol>
        </details>)}</div>
        {preview.content.valueStreams.length === 0 && <p>No value streams recorded in this version.</p>}
      </details>
      <details><summary>Sources ({preview.content.sources.length}) and origin</summary>
        <p>{preview.content.sourceDescription || 'No origin recorded.'}</p>
        <ul>{preview.content.sources.map((source, index) => <li key={index}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.citation}</a> : source.citation} · reviewed {source.reviewedAt}</li>)}</ul>
      </details>
      <p className={styles.previewFoot}>{preview.map.status === 'published' ? 'This is the version used when creating the next draft for this sector.' : 'This earlier version is available to inspect. The next draft starts from the current published version.'} Viewing a set does not change it or any seeded model.</p>
    </section>}
    <div className={styles.draftList} aria-label="Capability set drafts">{drafts.filter((d) => d.status === 'draft').map((entry) => <button type="button" key={entry.id} disabled={busy || dirty} onClick={() => { openDraft(entry); }}>
      {entry.content.title || entry.sector} · v{entry.version} <small>Edited {new Date(entry.updated_at).toLocaleDateString('en-GB')}</small>
    </button>)}</div>
    {dirty && <p role="status">Unsaved edits. Save before switching drafts or publishing.</p>}
    {draft && content && <div className={styles.editor}>
      <h3>{content.title || draft.sector} · v{draft.version} draft</h3>
      <div className={styles.actions}><button type="button" onClick={save} disabled={busy || !dirty}>Save draft</button><button type="button" onClick={validate} disabled={busy}>Validate and preview</button><button type="button" onClick={publish} disabled={busy || dirty || issues === null || issues.length > 0}>Publish this version</button></div>
      <div className={styles.fields}>
        <label>Title <input value={content.title} onChange={(e) => { change({ ...content, title: e.target.value }); }} /></label>
        <label>Summary <textarea value={content.summary} onChange={(e) => { change({ ...content, summary: e.target.value }); }} /></label>
        <label>Where this set came from <textarea value={content.sourceDescription} onChange={(e) => { change({ ...content, sourceDescription: e.target.value }); }} /></label>
      </div>
      <h4>Capabilities ({content.items.length})</h4>
      <div className={styles.split}>
        <div className={styles.tree}>
          <label>Find a capability <input value={filter} onChange={(e) => { setFilter(e.target.value); }} placeholder="Name or code" /></label>
          <div className={styles.scroll}>{treeOrder(content.items).filter((i) => `${i.name} ${i.code}`.toLowerCase().includes(filter.toLowerCase())).map((item) => {
            const alignment = alignments.find((a) => a.item_code === item.code && a.reviewed_name === item.name && a.reviewed_description === (item.description ?? ''));
            return <button type="button" key={item.code} className={selectedCode === item.code ? styles.active : ''} style={{ paddingLeft: `${String(8 + (item.level - 1) * 14)}px` }} onClick={() => { setSelectedCode(item.code); setSearchedFor(null); setMatches([]); setIdentitySearch(''); setReviewBasis(''); setNewKey(''); setNewDefinition(''); }}>{item.name || '(unnamed)'} <small>{item.code} · {alignment ? 'Identity reviewed' : 'Needs identity review'}</small></button>;
          })}</div>
          <button type="button" onClick={() => { const code = `new-${crypto.randomUUID().slice(0, 8)}`; change({ ...content, items: [...content.items, { code, name: '', description: '', level: 1, parentCode: null, order: Math.max(0, ...content.items.filter((i) => i.parentCode === null).map((i) => i.order)) + 10 }] }); setSelectedCode(code); }}>Add capability</button>
        </div>
        <div className={styles.itemCard}>{selected ? <>
          <h5>Edit capability</h5>
          <label>Name <input value={selected.name} onChange={(e) => { updateItem(selected.code, { name: e.target.value }); }} /></label>
          <label>Code <input value={selected.code} onChange={(e) => { const old = selected.code, next = e.target.value; change({ ...content, items: content.items.map((i) => i.code === old ? { ...i, code: next } : i.parentCode === old ? { ...i, parentCode: next } : i) }); setSelectedCode(next); }} /></label>
          <label>Definition <textarea value={selected.description ?? ''} onChange={(e) => { updateItem(selected.code, { description: e.target.value }); }} /></label>
          <label>Parent <select value={selected.parentCode ?? ''} onChange={(e) => { const parent = content.items.find((i) => i.code === e.target.value); updateItem(selected.code, { parentCode: parent?.code ?? null, level: parent ? (parent.level + 1) as Item['level'] : 1 }); }}><option value="">Top level</option>{content.items.filter((i) => i.code !== selected.code && i.level < 3).map((i) => <option key={i.code} value={i.code}>{i.name || i.code}</option>)}</select></label>
          <label>Order within parent <input type="number" value={selected.order} onChange={(e) => { updateItem(selected.code, { order: Number(e.target.value) }); }} /></label>
          <button type="button" disabled={content.items.some((i) => i.parentCode === selected.code)} onClick={() => { change({ ...content, items: content.items.filter((i) => i.code !== selected.code) }); setSelectedCode(null); }}>Remove capability</button>
          <div className={styles.identity}>
            <strong>Canonical capability</strong>
            <p>{selectedAligned ? `Reviewed: ${selectedAlignment.kind === 'existing' ? 'existing shared identity' : 'new identity'}${selectedAlignment.stable_key ? ` (${selectedAlignment.stable_key})` : ''}.` : 'Review required before publishing. Search the library first; a matching name alone never creates a link.'}</p>
            <label>Search existing capability <input value={identitySearch} onChange={(e) => { setIdentitySearch(e.target.value); setSearchedFor(null); }} placeholder="Name or stable key" /></label>
            <button type="button" onClick={findIdentity} disabled={busy || identitySearch.trim().length < 2}>Search identities</button>
            {searchedFor !== null && <div role="status">{matches.length ? `${String(matches.length)} matches` : 'No matching canonical capability found. Check the wording before creating a new identity.'}</div>}
            <label>Reason for this identity choice <textarea value={reviewBasis} onChange={(e) => { setReviewBasis(e.target.value); }} placeholder="Why this is the same capability, or why it needs a distinct identity" /></label>
            {matches.map((match) => <div className={styles.match} key={`${match.capability_id}-${String(match.revision)}`}>
              <strong>{match.name}</strong><small>{match.stable_key} · revision {match.revision}</small><p>{match.definition}</p>
              <button type="button" disabled={busy || dirty || !reviewBasis.trim()} onClick={() => { align({ kind: 'existing', capabilityId: match.capability_id, revision: match.revision, reviewBasis }); }}>Use this capability</button>
            </div>)}
            {searchedFor !== null && <details><summary>Create a distinct capability</summary>
              <p>Choose this only after checking existing identities. This creates a new platform identity when the map is published.</p>
              <label>Stable key <input value={newKey} onChange={(e) => { setNewKey(e.target.value); }} placeholder="connection-quoting" /></label>
              <label>Definition <textarea value={newDefinition} onChange={(e) => { setNewDefinition(e.target.value); }} placeholder="What this capability means across sectors" /></label>
              <button type="button" disabled={busy || dirty || !reviewBasis.trim() || !newKey.trim() || !newDefinition.trim()} onClick={() => { align({ kind: 'new', stableKey: newKey, definition: newDefinition, reviewBasis }); }}>Use a new identity</button>
            </details>}
          </div>
        </> : <p>Select a capability to edit its details.</p>}</div>
      </div>
      <h4>Sources</h4><p>Evidence and review details are part of the published record. Reviewer names are internal to this admin view.</p>
      <div className={styles.cards}>{content.sources.map((source, index) => <details className={styles.itemCard} key={index}><summary>{source.citation || 'New source'}</summary>
        <label>Citation <input value={source.citation} onChange={(e) => { change({ ...content, sources: content.sources.map((s, n) => n === index ? { ...s, citation: e.target.value } : s) }); }} /></label>
        <label>URL <input type="url" value={source.url ?? ''} onChange={(e) => { change({ ...content, sources: content.sources.map((s, n) => n === index ? { ...s, url: e.target.value } : s) }); }} /></label>
        <label>Reviewed by <input value={source.reviewedBy} onChange={(e) => { change({ ...content, sources: content.sources.map((s, n) => n === index ? { ...s, reviewedBy: e.target.value } : s) }); }} /></label>
        <label>Review date <input type="date" value={source.reviewedAt} onChange={(e) => { change({ ...content, sources: content.sources.map((s, n) => n === index ? { ...s, reviewedAt: e.target.value } : s) }); }} /></label>
        <button type="button" onClick={() => { change({ ...content, sources: content.sources.filter((_, n) => n !== index) }); }}>Remove source</button>
      </details>)}</div>
      <button type="button" onClick={() => { change({ ...content, sources: [...content.sources, { citation: '', url: '', reviewedBy: '', reviewedAt: new Date().toISOString().slice(0, 10) }] }); }}>Add source</button>
      <h4>Value streams ({content.valueStreams.length})</h4>
      <p>Stages refer to capabilities by their exact name. Check these links after renaming a capability.</p>
      <div className={styles.cards}>{content.valueStreams.map((stream, si) => <details className={styles.itemCard} key={si}><summary>{stream.name || 'New stream'} · {stream.stages.length} stages</summary>
        <label>Stream name <input value={stream.name} onChange={(e) => { updateStream(si, { name: e.target.value }); }} /></label>
        <label>Code <input value={stream.code} onChange={(e) => { updateStream(si, { code: e.target.value }); }} /></label>
        <label>Description <textarea value={stream.description ?? ''} onChange={(e) => { updateStream(si, { description: e.target.value }); }} /></label>
        <label>Order <input type="number" value={stream.order} onChange={(e) => { updateStream(si, { order: Number(e.target.value) }); }} /></label>
        <button type="button" onClick={() => { change({ ...content, valueStreams: content.valueStreams.filter((_, n) => n !== si) }); }}>Remove stream</button>
        <strong>Stages</strong>{stream.stages.map((stage, sj) => <details className={styles.itemCard} key={sj}><summary>{stage.name || 'New stage'}</summary>
          <label>Stage name <input value={stage.name} onChange={(e) => { updateStage(si, sj, { name: e.target.value }); }} /></label>
          <label>Code <input value={stage.code} onChange={(e) => { updateStage(si, sj, { code: e.target.value }); }} /></label>
          <label>Description <textarea value={stage.description ?? ''} onChange={(e) => { updateStage(si, sj, { description: e.target.value }); }} /></label>
          <label>Order <input type="number" value={stage.order} onChange={(e) => { updateStage(si, sj, { order: Number(e.target.value) }); }} /></label>
          <span>Enabled by: {stage.enables.join(', ') || 'None'}</span>
          <label>Add capability <select value="" onChange={(e) => { if (e.target.value && !stage.enables.includes(e.target.value)) updateStage(si, sj, { enables: [...stage.enables, e.target.value] }); }}><option value="">Choose a capability</option>{content.items.map((item) => <option key={item.code} value={item.name}>{item.name || item.code}</option>)}</select></label>
          {stage.enables.map((name, index) => <button type="button" key={index} onClick={() => { updateStage(si, sj, { enables: stage.enables.filter((_, n) => n !== index) }); }}>Remove {name}</button>)}
          <button type="button" onClick={() => { updateStream(si, { stages: stream.stages.filter((_, n) => n !== sj) }); }}>Remove stage</button>
        </details>)}
        <button type="button" onClick={() => { updateStream(si, { stages: [...stream.stages, { code: '', name: '', description: '', order: Math.max(0, ...stream.stages.map((s) => s.order)) + 10, enables: [] }] }); }}>Add stage</button>
      </details>)}</div>
      <button type="button" onClick={() => { change({ ...content, valueStreams: [...content.valueStreams, { code: '', name: '', description: '', order: Math.max(0, ...content.valueStreams.map((s) => s.order)) + 10, stages: [] }] }); }}>Add value stream</button>
      {issues && <div className={styles.review}><h4>Publication review</h4>{issues.length ? <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>Validation passed. This will publish {content.items.length} capabilities and {content.valueStreams.length} value streams as {draft.sector} v{draft.version}.</p>}
        {baseContent && <p>Compared with the starting version: {content.items.filter((i) => !baseContent.items.some((old) => old.code === i.code)).length} capabilities added, {baseContent.items.filter((old) => !content.items.some((i) => i.code === old.code)).length} removed, {content.items.filter((i) => baseContent.items.some((old) => old.code === i.code && (old.name !== i.name || old.description !== i.description || old.parentCode !== i.parentCode || old.order !== i.order))).length} changed. Sources {JSON.stringify(content.sources) === JSON.stringify(baseContent.sources) ? 'unchanged' : 'changed'}; value streams {JSON.stringify(content.valueStreams) === JSON.stringify(baseContent.valueStreams) ? 'unchanged' : 'changed'}. A code change appears as a removal and addition and needs a fresh canonical alignment. Earlier versions and seeded models stay unchanged.</p>}
      </div>}
    </div>}
  </SettingsSection>;
}
