import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Icon, Modal } from '../ui';
import { exportCsv } from '../hooks';
import { errorReportRows, exportColumns, planImport, readImportFile, templateRecords } from './productCsv';
import { loadImportContext, runImport } from './productApi';

// Import products from a CSV, in four steps: choose the file -> read the problems ("preview") -> run -> summary.
// Nothing is written until "Import" is pressed. A product is imported only if EVERY row of it is valid (so a product
// is never half-imported); products that are already correct are left alone, which makes re-importing an export a no-op.
const MAX_BYTES = 8 * 1024 * 1024;
const SHOW = 150;

export default function ProductImportDialog({ open, onClose, categories, onDone }) {
  const [step, setStep] = useState('choose');
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [results, setResults] = useState([]);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [limit, setLimit] = useState(SHOW);
  const cancel = useRef(false);
  const input = useRef(null);
  const importedSomething = useRef(false);

  useEffect(() => {
    if (open) { setStep('choose'); setError(''); setFile(null); setPlan(null); setResults([]); setFileName(''); setOnlyProblems(false); setLimit(SHOW); importedSomething.current = false; }
  }, [open]);

  async function pick(f) {
    if (!f) return;
    setError('');
    if (f.size > MAX_BYTES) { setError(`That file is ${(f.size / 1048576).toFixed(1)} MB; the limit is ${MAX_BYTES / 1048576} MB. Split it into smaller files.`); return; }
    setFileName(f.name);
    setStep('reading');
    try {
      const parsed = readImportFile(await f.text());
      if (!parsed.ok) { setError(parsed.error); setStep('choose'); return; }
      if (!parsed.records.length) { setError('The file has a header but no product rows.'); setStep('choose'); return; }
      const ctx = await loadImportContext(parsed.records);
      setFile(parsed);
      setPlan(planImport(parsed.records, { ...ctx, categories }));
      setStep('preview');
    } catch (e) {
      setError(`The file could not be checked: ${e?.message || e}`);
      setStep('choose');
    }
  }

  async function run() {
    cancel.current = false;
    setStep('running');
    setProgress({ done: 0, total: plan.products.filter(p => !p.errors.length && p.changed).length, current: '' });
    const res = await runImport(plan, { onProgress: setProgress, shouldCancel: () => cancel.current });
    setResults(res);
    importedSomething.current = res.some(r => r.ok);
    setStep('done');
    if (res.some(r => r.ok)) onDone?.();
  }

  const problemsByLine = useMemo(() => {
    const m = new Map();
    (plan?.problems || []).forEach(p => m.set(p.line, [...(m.get(p.line) || []), p]));
    return m;
  }, [plan]);

  const rows = useMemo(() => {
    if (!plan) return [];
    const out = [];
    for (const P of plan.products) {
      P.variants.forEach((v, i) => {
        const rec = P.rows[i];
        const own = problemsByLine.get(rec.line) || [];
        const skipped = P.errors.length > 0;
        let action = 'Create';
        if (skipped) action = 'Skipped';
        else if (P.action === 'update') action = v.action === 'create' ? 'New variant' : (v.patch || v.stockTo !== null || (i === 0 && Object.keys(P.patch).length) ? 'Update' : 'No change');
        out.push({ key: `${P.key}-${rec.line}`, P, v, rec, action, own, skipped });
      });
    }
    return out.sort((a, b) => a.rec.line - b.rec.line);
  }, [plan, problemsByLine]);

  const shown = (onlyProblems ? rows.filter(r => r.own.length || r.skipped) : rows).slice(0, limit);
  const totalShown = onlyProblems ? rows.filter(r => r.own.length || r.skipped).length : rows.length;

  function downloadTemplate() { exportCsv('product-import-template.csv', exportColumns(), templateRecords(categories)); }

  function downloadReport() {
    const base = errorReportRows(file, plan);
    const failed = results.filter(r => !r.ok).flatMap((r) => {
      const P = plan.products.find(p => p.key === r.key);
      return (P?.rows || []).map((rec) => {
        const row = {};
        file.header.forEach((h, i) => { row[h || `column_${i + 1}`] = rec.raw[i] ?? ''; });
        row.import_line = rec.line; row.import_level = 'failed'; row.import_problem = `Failed while importing: ${r.message}`;
        return row;
      });
    });
    const all = [...base, ...failed].sort((a, b) => a.import_line - b.import_line);
    const cols = [...file.header.map((h, i) => h || `column_${i + 1}`), 'import_line', 'import_level', 'import_problem'].map(label => ({ label, get: r => r[label] }));
    exportCsv('product-import-errors.csv', cols, all);
  }

  const t = plan?.totals;
  const willWrite = t ? t.creates + t.updates : 0;
  const hasIssues = !!t && (t.errors > 0 || results.some(r => !r.ok));

  const closeable = step !== 'running';
  function close() { if (closeable) onClose(); else toast('Import in progress - cancel it first.'); }

  let footer;
  if (step === 'choose' || step === 'reading') footer = <Button onClick={close} disabled={step === 'reading'}>Cancel</Button>;
  else if (step === 'preview') {
    footer = (
      <>
        <Button onClick={() => { setStep('choose'); setPlan(null); setFile(null); }}>Choose another file</Button>
        {t.errors > 0 && <Button icon="download" onClick={downloadReport}>Error report</Button>}
        <Button variant="primary" icon="upload" disabled={willWrite === 0} onClick={run}>
          {willWrite === 0 ? (t.errors ? 'Nothing valid to import' : 'Nothing to change') : `Import ${t.validRows.toLocaleString('en-IN')} valid row${t.validRows === 1 ? '' : 's'}`}
        </Button>
      </>
    );
  } else if (step === 'running') footer = <Button onClick={() => { cancel.current = true; }}>Stop after this product</Button>;
  else footer = (<>{hasIssues && <Button icon="download" onClick={downloadReport}>Error report</Button>}<Button variant="primary" onClick={onClose}>Done</Button></>);

  return (
    <Modal
      open={open} onClose={close} size="lg" dismissable={closeable} busy={step === 'running' || step === 'reading'}
      title="Import products from CSV"
      subtitle={step === 'choose' ? 'One row per variant. New products are created, existing ones (matched by product number) are updated.' : fileName}
      footer={footer}
    >
      {step === 'choose' && (
        <div className="adm-stack">
          <div className="pi-drop">
            <input ref={input} type="file" accept=".csv,text/csv,text/plain" hidden onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" className="adm-dropzone" onClick={() => input.current?.click()}><Icon name="upload" size={17} /> Choose a CSV file</button>
            <span className="adm-hint">Up to 8 MB. Excel: use “Save as → CSV (comma delimited)”.</span>
          </div>
          {error && <div className="adm-note danger" role="alert">{error}</div>}
          <div className="adm-note">
            <strong>New here?</strong> <button type="button" className="adm-link-btn" onClick={downloadTemplate}>Download the template</button> to see the columns. Leave a cell empty to keep a value as it is (or use the default for a new product).
            Match products by <code>product_number</code> and variants by <code>sku</code>; stock changes are recorded in the stock ledger.
          </div>
        </div>
      )}

      {step === 'reading' && <div className="pi-working"><span className="adm-spinner" aria-hidden="true" /> Checking the file against your catalogue…</div>}

      {step === 'preview' && plan && (
        <div className="adm-stack">
          <div className="pi-tiles">
            <Tile n={t.rows} label="Rows in file" />
            <Tile n={t.creates} label="New products" tone="success" />
            <Tile n={t.updates} label="Products to update" tone="info" />
            <Tile n={t.unchanged} label="Already up to date" />
            <Tile n={t.skippedRows} label="Rows skipped (errors)" tone={t.skippedRows ? 'danger' : undefined} />
            <Tile n={t.warnings} label="Warnings" tone={t.warnings ? 'warning' : undefined} />
          </div>
          {file.parseError && <div className="adm-note danger">{file.parseError}</div>}
          {file.unknownColumns.length > 0 && <div className="adm-note info">Ignored columns: {file.unknownColumns.join(', ')}.</div>}
          {t.errors > 0 && <div className="adm-note warning">A product is imported only when all of its rows are valid, so products with an error are skipped completely. Fix the file and import it again - products that are already up to date are left alone.</div>}
          <label className="pi-only">
            <input type="checkbox" checked={onlyProblems} onChange={e => { setOnlyProblems(e.target.checked); setLimit(SHOW); }} /> Show only rows with problems
          </label>
          <div className="pi-scroll">
            <table className="pi-table">
              <thead><tr><th>Line</th><th>Product</th><th>Variant</th><th>Result</th><th>Notes</th></tr></thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.key} className={r.skipped ? 'is-skipped' : r.own.some(p => p.level === 'error') ? 'is-error' : ''}>
                    <td className="adm-mono">{r.rec.line}</td>
                    <td><strong>{r.P.name || '—'}</strong>{r.P.number && <span className="adm-cell-sub" style={{ display: 'block' }}>{r.P.number}</span>}</td>
                    <td>{r.v.hasOptions ? r.v.label : (r.v.sku ? '' : '—')}{r.v.sku && <span className="adm-cell-sub" style={{ display: 'block' }}>{r.v.sku}</span>}</td>
                    <td><span className={`pi-chip ${chipTone(r.action)}`}>{r.action}</span></td>
                    <td className="pi-notes">
                      {r.own.map((p, i) => <div key={i} className={p.level === 'error' ? 'pi-err' : 'pi-warn'}>{p.message}</div>)}
                      {r.skipped && !r.own.some(p => p.level === 'error') && <div className="pi-err">Skipped: another row of this product has an error.</div>}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={5} className="adm-muted" style={{ textAlign: 'center', padding: 24 }}>No rows to show.</td></tr>}
              </tbody>
            </table>
          </div>
          {totalShown > shown.length && <div><Button size="sm" onClick={() => setLimit(l => l + SHOW)}>Show {Math.min(SHOW, totalShown - shown.length)} more ({totalShown - shown.length} hidden)</Button></div>}
        </div>
      )}

      {step === 'running' && (
        <div className="adm-stack" aria-live="polite">
          <div className="pi-working"><span className="adm-spinner" aria-hidden="true" /> Importing {Math.min(progress.done + 1, progress.total)} of {progress.total}… <span className="adm-muted">{progress.current}</span></div>
          <div className="adm-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
          <p className="adm-hint">Keep this window open. Each product is saved in full before the next starts.</p>
        </div>
      )}

      {step === 'done' && <Summary plan={plan} results={results} />}
    </Modal>
  );
}

function chipTone(action) {
  return action === 'Create' || action === 'New variant' ? 'success' : action === 'Update' ? 'info' : action === 'Skipped' ? 'danger' : 'neutral';
}

function Tile({ n, label, tone }) {
  return <div className={`pi-tile${tone ? ` ${tone}` : ''}`}><b>{Number(n).toLocaleString('en-IN')}</b><span>{label}</span></div>;
}

function Summary({ plan, results }) {
  const ok = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);
  const created = ok.filter(r => r.action === 'create').length;
  const updated = ok.filter(r => r.action === 'update').length;
  const variants = ok.reduce((s, r) => s + r.created, 0);
  const stock = ok.reduce((s, r) => s + r.stock, 0);
  const notRun = plan.products.filter(p => !p.errors.length && p.changed).length - results.length;
  return (
    <div className="adm-stack">
      <div className={`adm-note ${failed.length ? 'warning' : 'success'}`} role="status">
        {failed.length ? 'The import finished with some problems.' : 'The import finished.'}
      </div>
      <div className="pi-tiles">
        <Tile n={created} label="Products created" tone="success" />
        <Tile n={updated} label="Products updated" tone="info" />
        <Tile n={plan.totals.unchanged} label="Already up to date" />
        <Tile n={plan.totals.skippedRows} label="Rows skipped (errors)" tone={plan.totals.skippedRows ? 'danger' : undefined} />
        <Tile n={failed.length} label="Failed while saving" tone={failed.length ? 'danger' : undefined} />
        <Tile n={stock} label="Stock adjustments" />
      </div>
      <p className="adm-hint">{variants} new variant{variants === 1 ? '' : 's'} added.{notRun > 0 ? ` ${notRun} product${notRun === 1 ? ' was' : 's were'} not started because you stopped the import.` : ''}</p>
      {failed.length > 0 && (
        <div>
          <div className="adm-label">Could not be saved</div>
          <ul className="pi-fails">{failed.map(r => <li key={r.key}><strong>{r.name || r.number}</strong>: {r.message}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
