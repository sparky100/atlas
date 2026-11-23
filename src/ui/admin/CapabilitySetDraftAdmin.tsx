import { useEffect, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { capabilityMapContentSchema, type CapabilityMapContent } from '../../contracts/capabilityMapContent';
import {
  alignDraftItem,
  copyReferenceMap,
  listDraftAlignments,
  listReferenceMaps,
  publishReferenceMapDraft,
  saveReferenceMapDraft,
  searchCanonicalCapabilities,
  validateReferenceMap,
  type CanonicalCapabilityMatch,
  type DraftAlignment,
  type ReferenceMapDraft,
  type ReferenceMapSummary,
} from '../../db/referenceMapAdmin';
import { Loading } from '../components/Loading/Loading';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { useUnsavedChanges } from '../routes/platformAdmin/unsavedChanges';
import { treeOrder, type CapabilitySetItem as Item } from './capabilitySetTree';
import styles from './CapabilitySetAdmin.module.css';

const BASE = '/platform-admin/capability-sets';

type Stream = CapabilityMapContent['valueStreams'][number];
type Stage = Stream['stages'][number];

/**
 * `/platform-admin/capability-sets/drafts/:draftId` — one capability-set
 * draft and everything needed to publish it: set details, the capability
 * tree and its canonical identity, sources, value streams and the
 * publication review. The list and the published-version page are separate
 * routes; this page owns only the editable draft.
 */
export function CapabilitySetDraftAdmin({ draftId }: { draftId: string }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<ReferenceMapDraft | null>(null);
  const [baseContent, setBaseContent] = useState<CapabilityMapContent | null>(null);
  const [alignments, setAlignments] = useState<DraftAlignment[]>([]);
  const [content, setContent] = useState<CapabilityMapContent | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [identitySearch, setIdentitySearch] = useState('');
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  const [matches, setMatches] = useState<CanonicalCapabilityMatch[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newDefinition, setNewDefinition] = useState('');
  const [reviewBasis, setReviewBasis] = useState('');
  const [issues, setIssues] = useState<string[] | null>(null);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const result = await listReferenceMaps(supabase);
        const found = result.drafts.find((candidate) => candidate.id === draftId) ?? null;
        if (!found) throw new Error('This capability set draft could not be found.');
        const base: ReferenceMapSummary | undefined = found.base_map_id === null
          ? undefined
          : result.maps.find((candidate) => candidate.id === found.base_map_id);
        const [baseCopy, loadedAlignments] = await Promise.all([
          base ? copyReferenceMap(supabase, base) : Promise.resolve(null),
          listDraftAlignments(supabase, found.id),
        ]);
        setDraft(found);
        setBaseContent(baseCopy);
        setAlignments(loadedAlignments);
        setContent(found.content);
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, [draftId]);

  const dirty = draft !== null && content !== null && JSON.stringify(content) !== JSON.stringify(draft.content);
  useUnsavedChanges(dirty);
  const selected = content?.items.find((item) => item.code === selectedCode);
  const selectedAlignment = alignments.find((alignment) => alignment.item_code === selectedCode);
  const selectedAligned = selected !== undefined
    && selectedAlignment?.reviewed_name === selected.name
    && selectedAlignment.reviewed_description === (selected.description ?? '');

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const change = (next: CapabilityMapContent) => { setContent(next); setIssues(null); };
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

  const save = () => void run(async () => {
    if (!draft || !content) return;
    const revision = await saveReferenceMapDraft(supabase, draft, content);
    setDraft({ ...draft, content, edit_revision: revision });
    setNotice(`Draft saved (revision ${String(revision)}).`);
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
    setNotice(localIssues.length + serverIssues.length + identityIssues.length === 0
      ? 'Ready for publication. Review the comparison and save before publishing.'
      : 'Resolve the issues shown below.');
  });

  const publish = () => void run(async () => {
    if (!draft || !content || dirty || !issues || issues.length > 0) return;
    const id = await publishReferenceMapDraft(supabase, draft);
    void navigate(`${BASE}/versions/${id}`);
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
    setIssues(null);
    setNotice(`Identity reviewed for ${selected.name}. Validate again before publishing.`);
  });

  const leave = (event: MouseEvent) => {
    if (!dirty) return;
    event.preventDefault();
    if (window.confirm('You have unsaved changes. Leave without saving?')) void navigate(BASE);
  };

  if (loading) return <Loading />;
  if (loadError !== '' || draft === null || content === null) {
    return (
      <div className={styles.page}>
        <Link to={BASE} className={styles.backLink}>← Capability sets</Link>
        <p role="alert" className={styles.error}>{loadError !== '' ? loadError : 'This capability set draft could not be loaded.'}</p>
      </div>
    );
  }

  return (
    <div className={styles.page} data-testid="capability-set-draft">
      <Link to={BASE} className={styles.backLink} onClick={leave}>← Capability sets</Link>
      <div>
        <Text as="h1" size="2xl">
          {content.title !== '' ? content.title : draft.sector}
        </Text>
        <Text as="p" tone="muted" size="sm">
          {draft.sector.replaceAll('_', ' ')} · v{draft.version} draft · edited {new Date(draft.updated_at).toLocaleDateString('en-GB')}
        </Text>
      </div>

      <div className={[styles.actions, styles.stickyActions].filter(Boolean).join(' ')}>
        <button type="button" onClick={save} disabled={busy || !dirty}>Save draft</button>
        <button type="button" onClick={validate} disabled={busy}>Validate and preview</button>
        <button type="button" onClick={publish} disabled={busy || dirty || issues === null || issues.length > 0}>Publish this version</button>
      </div>
      {dirty && <p role="status">Unsaved edits. Save before publishing or leaving this draft.</p>}
      {error !== '' && <p role="alert" className={styles.error}>{error}</p>}
      {notice !== '' && <p role="status">{notice}</p>}

      <div className={styles.fields}>
        <label>Title <input value={content.title} onChange={(e) => { change({ ...content, title: e.target.value }); }} /></label>
        <label>Summary <textarea value={content.summary} onChange={(e) => { change({ ...content, summary: e.target.value }); }} /></label>
        <label>Where this set came from <textarea value={content.sourceDescription} onChange={(e) => { change({ ...content, sourceDescription: e.target.value }); }} /></label>
      </div>

      <h2>Capabilities ({content.items.length})</h2>
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
          <h3>Edit capability</h3>
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

      <h2>Sources</h2>
      <p>Evidence and review details are part of the published record. Reviewer names are internal to this admin view.</p>
      <div className={styles.cards}>{content.sources.map((source, index) => <details className={styles.itemCard} key={index}><summary>{source.citation || 'New source'}</summary>
        <label>Citation <input value={source.citation} onChange={(e) => { change({ ...content, sources: content.sources.map((s, n) => n === index ? { ...s, citation: e.target.value } : s) }); }} /></label>
        <label>URL <input type="url" value={source.url ?? ''} onChange={(e) => { change({ ...content, sources: content.sources.map((s, n) => n === index ? { ...s, url: e.target.value } : s) }); }} /></label>
        <label>Reviewed by <input value={source.reviewedBy} onChange={(e) => { change({ ...content, sources: content.sources.map((s, n) => n === index ? { ...s, reviewedBy: e.target.value } : s) }); }} /></label>
        <label>Review date <input type="date" value={source.reviewedAt} onChange={(e) => { change({ ...content, sources: content.sources.map((s, n) => n === index ? { ...s, reviewedAt: e.target.value } : s) }); }} /></label>
        <button type="button" onClick={() => { change({ ...content, sources: content.sources.filter((_, n) => n !== index) }); }}>Remove source</button>
      </details>)}</div>
      <button type="button" onClick={() => { change({ ...content, sources: [...content.sources, { citation: '', url: '', reviewedBy: '', reviewedAt: new Date().toISOString().slice(0, 10) }] }); }}>Add source</button>

      <h2>Value streams ({content.valueStreams.length})</h2>
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

      {issues && <div className={styles.review}><h2>Publication review</h2>{issues.length ? <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>Validation passed. This will publish {content.items.length} capabilities and {content.valueStreams.length} value streams as {draft.sector} v{draft.version}.</p>}
        {baseContent && <p>Compared with the starting version: {content.items.filter((i) => !baseContent.items.some((old) => old.code === i.code)).length} capabilities added, {baseContent.items.filter((old) => !content.items.some((i) => i.code === old.code)).length} removed, {content.items.filter((i) => baseContent.items.some((old) => old.code === i.code && (old.name !== i.name || old.description !== i.description || old.parentCode !== i.parentCode || old.order !== i.order))).length} changed. Sources {JSON.stringify(content.sources) === JSON.stringify(baseContent.sources) ? 'unchanged' : 'changed'}; value streams {JSON.stringify(content.valueStreams) === JSON.stringify(baseContent.valueStreams) ? 'unchanged' : 'changed'}. A code change appears as a removal and addition and needs a fresh canonical alignment. Earlier versions and seeded models stay unchanged.</p>}
      </div>}
    </div>
  );
}
