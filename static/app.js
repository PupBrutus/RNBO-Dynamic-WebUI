// RNBO Control Server - builds the UI from the runner's OSCQuery JSON (port 5678).
// Everything here is driven by the live graph; see README "Control metadata (@meta)".
(function () {
    'use strict';

    const config = window.RNBO_CONFIG || {};
    const BUTTON_WORDS = ['play', 'start', 'stop', 'trigger', 'trig', 'bang', 'reset'];
    const TOGGLE_WORDS = ['loop', 'mute', 'on', 'enable', 'enabled'];

    // ---------- helpers ----------

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function setStatus(text, isError) {
        const status = document.getElementById('status');
        status.textContent = text;
        status.classList.toggle('status-error', !!isError);
    }

    // Parse a `meta` string from the runner. Empty or invalid JSON -> {}.
    function parseMeta(raw) {
        if (!raw || typeof raw !== 'string') return {};
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (e) {
            console.warn('Ignoring meta that is not JSON:', raw);
            return {};
        }
    }

    // "playFile" / "play_file" / "loop-on" -> ["play", "file"] etc.
    function nameWords(name) {
        return name
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean);
    }

    // Fallback when an inport has no meta: guess the control from its name.
    function inferInportUi(name) {
        const words = nameWords(name);
        if (words.some(w => TOGGLE_WORDS.includes(w))) return 'toggle';
        if (words.some(w => BUTTON_WORDS.includes(w))) return 'button';
        return 'text';
    }

    function prettyName(name) {
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    function formatValue(value, min, max) {
        const v = Number(value);
        if (!isFinite(v)) return String(value);
        const span = Math.abs(Number(max) - Number(min));
        const decimals = span <= 2 ? 3 : span <= 20 ? 2 : 1;
        return v.toFixed(decimals);
    }

    // POST to Flask, which forwards the value to the runner over OSC (UDP 1234).
    function send(path, value) {
        const body = new URLSearchParams({ value: String(value), instanceParam: path, action: 'connect' });
        return fetch('/', { method: 'POST', body })
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                console.log(`Sent ${path} = ${value}`);
            })
            .catch(err => {
                console.error(`Failed to send ${path}:`, err);
                setStatus(`Send failed: ${path}`, true);
            });
    }

    // Coalesce rapid slider input to at most one send per animation frame.
    function throttledSender(path) {
        let pending = null;
        let scheduled = false;
        return value => {
            pending = value;
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                send(path, pending);
            });
        };
    }

    async function fetchJSON() {
        const url = `http://${config.server}:${config.queryPort}/`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
    }

    // ---------- controls ----------

    function controlShell(label, extraClass) {
        const row = el('div', 'control' + (extraClass ? ' ' + extraClass : ''));
        const head = el('div', 'control-head');
        head.appendChild(el('span', 'control-label', label));
        row.appendChild(head);
        return { row, head };
    }

    function createSlider({ label, min, max, step, value, unit, path, onValue }) {
        const { row, head } = controlShell(label, 'control-slider');
        const readout = el('span', 'control-value', formatValue(value, min, max) + (unit ? ` ${unit}` : ''));
        head.appendChild(readout);
        const input = el('input');
        input.type = 'range';
        input.min = min;
        input.max = max;
        input.step = step || 'any';
        input.value = value;
        input.setAttribute('aria-label', label);
        const sendThrottled = throttledSender(path);
        input.addEventListener('input', () => {
            readout.textContent = formatValue(input.value, min, max) + (unit ? ` ${unit}` : '');
            sendThrottled(input.value);
            if (onValue) onValue(input.value);
        });
        row.appendChild(input);
        return row;
    }

    function createToggle({ label, on, path, onValue, offValue, storeKey }) {
        const { row } = controlShell(label, 'control-toggle');
        const button = el('button', 'btn btn-toggle');
        button.type = 'button';
        button.setAttribute('role', 'switch');
        const render = state => {
            button.classList.toggle('is-on', state);
            button.setAttribute('aria-checked', String(state));
            button.textContent = state ? 'On' : 'Off';
        };
        let state = !!on;
        render(state);
        button.addEventListener('click', () => {
            state = !state;
            render(state);
            if (storeKey) localStorage.setItem(storeKey, state ? '1' : '0');
            send(path, state ? onValue : offValue);
        });
        row.appendChild(button);
        return row;
    }

    function createButton({ label, path, value }) {
        const row = el('div', 'control control-button');
        const button = el('button', 'btn btn-trigger', label);
        button.type = 'button';
        button.addEventListener('click', () => {
            send(path, value);
            button.classList.add('is-flash');
            setTimeout(() => button.classList.remove('is-flash'), 150);
        });
        row.appendChild(button);
        return row;
    }

    function createTextSend({ label, path, value }) {
        const { row } = controlShell(label, 'control-text');
        const form = el('form', 'text-send');
        const input = el('input');
        input.type = 'text';
        input.value = value;
        input.setAttribute('aria-label', label);
        const button = el('button', 'btn', 'Send');
        button.type = 'submit';
        form.addEventListener('submit', event => {
            event.preventDefault();
            send(path, input.value);
        });
        form.appendChild(input);
        form.appendChild(button);
        row.appendChild(form);
        return row;
    }

    function createSelect({ label, options, value, path, placeholder, onChange }) {
        const { row } = controlShell(label, 'control-select');
        const select = el('select');
        select.setAttribute('aria-label', label);
        if (placeholder && !options.includes(value)) {
            const opt = el('option', null, placeholder);
            opt.value = '';
            opt.disabled = true;
            opt.selected = true;
            select.appendChild(opt);
        }
        options.forEach(optionValue => {
            const opt = el('option', null, optionValue);
            opt.value = optionValue;
            if (optionValue === value) opt.selected = true;
            select.appendChild(opt);
        });
        select.addEventListener('change', async () => {
            await send(path, select.value);
            if (onChange) onChange(select.value);
        });
        row.appendChild(select);
        return row;
    }

    // ---------- params / inports / data refs ----------

    // Returns { el, order, group, sortKey } or null when hidden/unsupported.
    function buildParam(paramId, param) {
        const c = param.CONTENTS || {};
        const meta = parseMeta(c.meta?.VALUE);
        if (meta.ui === 'hidden') return null;
        const label = meta.label || c.display_name?.VALUE || paramId;
        const path = param.FULL_PATH;
        const range = (param.RANGE && param.RANGE[0]) || {};
        const vals = range.VALS;
        const isBinaryEnum = Array.isArray(vals) && vals.length === 2 && vals[0] === '0' && vals[1] === '1';
        let ui = meta.ui;
        if (!ui) {
            if (param.TYPE === 'f') ui = 'slider';
            else if (param.TYPE === 's' && isBinaryEnum) ui = 'toggle';
            else if (param.TYPE === 's' && Array.isArray(vals)) ui = 'menu';
            else return null;
        }

        let node;
        const min = meta.min ?? range.MIN ?? 0;
        const max = meta.max ?? range.MAX ?? 1;
        if (ui === 'toggle') {
            const onValue = meta.value ?? (Array.isArray(vals) ? vals[vals.length - 1] : max);
            const offValue = Array.isArray(vals) ? vals[0] : min;
            node = createToggle({ label, path, on: String(param.VALUE) === String(onValue), onValue, offValue });
        } else if (ui === 'menu' && Array.isArray(vals)) {
            node = createSelect({ label, options: vals, value: param.VALUE, path });
        } else if (ui === 'button') {
            node = createButton({ label, path, value: meta.value ?? max });
        } else if (ui === 'text') {
            node = createTextSend({ label, path, value: meta.value ?? param.VALUE });
        } else if (param.TYPE === 'f') {
            node = createSlider({ label, path, min, max, step: meta.step, value: param.VALUE, unit: c.unit?.VALUE });
        } else if (Array.isArray(vals)) {
            node = createSelect({ label, options: vals, value: param.VALUE, path });
        } else {
            return null;
        }
        return { el: node, order: meta.order, group: 0, sortKey: c.index?.VALUE ?? paramId };
    }

    function buildInport(messageId, message) {
        const meta = parseMeta(message.CONTENTS?.meta?.VALUE);
        if (meta.ui === 'hidden') return null;
        const label = meta.label || prettyName(messageId);
        const path = message.FULL_PATH;
        const ui = meta.ui || inferInportUi(messageId);
        const storeKey = `rnbo:${path}`;
        let node;
        if (ui === 'button') {
            node = createButton({ label, path, value: meta.value ?? 1 });
        } else if (ui === 'toggle') {
            // Inports have no readable state, so the last toggle position is kept in this browser.
            node = createToggle({
                label, path, storeKey,
                on: localStorage.getItem(storeKey) === '1',
                onValue: meta.value ?? 1,
                offValue: 0
            });
        } else if (ui === 'slider') {
            const min = meta.min ?? 0;
            const max = meta.max ?? 1;
            const stored = localStorage.getItem(storeKey);
            node = createSlider({
                label, path, min, max, step: meta.step,
                value: stored !== null ? stored : min,
                onValue: v => localStorage.setItem(storeKey, v)
            });
        } else {
            node = createTextSend({ label, path, value: meta.value ?? '1' });
        }
        return { el: node, order: meta.order, group: 1, sortKey: messageId };
    }

    function buildDataRef(dataRefId, dataRef, filenames) {
        const meta = parseMeta(dataRef.CONTENTS?.meta?.VALUE);
        if (meta.ui === 'hidden') return null;
        const node = createSelect({
            label: meta.label || prettyName(dataRefId),
            options: filenames,
            value: dataRef.VALUE,
            path: dataRef.FULL_PATH,
            placeholder: dataRef.VALUE || 'no file loaded',
            onChange: () => setTimeout(generateControls, 500)
        });
        return { el: node, order: meta.order, group: 2, sortKey: dataRefId };
    }

    function compareItems(a, b) {
        const ao = typeof a.order === 'number' ? a.order : Infinity;
        const bo = typeof b.order === 'number' ? b.order : Infinity;
        if (ao !== bo) return ao - bo;
        if (a.group !== b.group) return a.group - b.group;
        if (typeof a.sortKey === 'number' && typeof b.sortKey === 'number') return a.sortKey - b.sortKey;
        return String(a.sortKey).localeCompare(String(b.sortKey), undefined, { numeric: true });
    }

    // ---------- routing ----------

    // JACK client name ("SoundFile-5") of a port ("SoundFile-5:out1").
    function portClient(port) {
        const i = port.lastIndexOf(':');
        return i === -1 ? port : port.slice(0, i);
    }

    function describeClient(port, clients) {
        const client = portClient(port);
        if (client === 'system') {
            const p = port.slice(port.lastIndexOf(':') + 1);
            if (p.startsWith('capture')) return { key: 'system:capture', text: 'Mic in', kind: 'system' };
            if (p.startsWith('playback')) return { key: 'system:playback', text: 'Output', kind: 'system' };
        }
        if (client === 'rnbo-record') return { key: client, text: 'Recorder', kind: 'system' };
        const inst = clients[client];
        if (inst) return { key: client, text: inst.label, kind: 'instance', id: inst.id };
        return { key: client, text: client, kind: 'other' };
    }

    // Unique peers of one instance in one direction.
    // Uses /rnbo/inst/N/jack/connections/audio/{sinks|sources}; falls back to /rnbo/jack/connections/audio.
    function routingPeers(instance, jackName, direction, globalAudio, clients) {
        const audio = instance.CONTENTS?.jack?.CONTENTS?.connections?.CONTENTS?.audio?.CONTENTS;
        const ports = [];
        const side = direction === 'in' ? audio?.sinks : audio?.sources;
        if (side) {
            Object.values(side.CONTENTS || {}).forEach(p => (p.VALUE || []).forEach(v => ports.push(v)));
        } else if (globalAudio) {
            Object.entries(globalAudio).forEach(([src, node]) => {
                const sinks = node.VALUE || [];
                if (direction === 'out' && portClient(src) === jackName) ports.push(...sinks);
                if (direction === 'in' && sinks.some(s => portClient(s) === jackName)) ports.push(src);
            });
        }
        const seen = new Map();
        ports.forEach(port => {
            const d = describeClient(port, clients);
            if (!seen.has(d.key)) seen.set(d.key, d);
        });
        return [...seen.values()];
    }

    function routingRow(label, peers) {
        const row = el('div', 'route-row');
        row.appendChild(el('span', 'route-label', label));
        const list = el('span', 'route-peers');
        if (peers.length === 0) {
            list.appendChild(el('span', 'chip chip-none', 'none'));
        } else {
            peers.forEach(p => {
                const chip = el(p.kind === 'instance' ? 'a' : 'span', `chip chip-${p.kind}`, p.text);
                if (p.kind === 'instance') {
                    chip.href = `#inst-${p.id}`;
                    chip.title = `Jump to instance ${p.id}`;
                }
                list.appendChild(chip);
            });
        }
        row.appendChild(list);
        return row;
    }

    // ---------- main ----------

    function extractFilenames(rnbo) {
        // The runner's last command response may hold a datafile listing (as before).
        const filenames = [];
        const contentString = rnbo?.CONTENTS?.resp?.VALUE;
        if (!contentString) return filenames;
        try {
            const parsed = JSON.parse(contentString);
            const content = JSON.parse(parsed.result.content);
            content.forEach(filePath => filenames.push(filePath.substring(filePath.lastIndexOf('/') + 1)));
        } catch (error) {
            console.warn('No datafile listing in runner response:', error);
        }
        return filenames;
    }

    async function generateControls() {
        const grid = document.getElementById('parameterControls');
        setStatus('Loading…');
        let json;
        try {
            json = await fetchJSON();
        } catch (error) {
            console.error('Error fetching JSON:', error);
            setStatus(`Cannot reach runner at ${config.server}:${config.queryPort}`, true);
            return;
        }

        const rnbo = json.CONTENTS?.rnbo;
        const filenames = extractFilenames(rnbo);
        const instances = Object.entries(rnbo?.CONTENTS?.inst?.CONTENTS || {})
            .filter(([id, inst]) => /^\d+$/.test(id) && inst.CONTENTS?.name?.VALUE)
            .sort((a, b) => Number(a[0]) - Number(b[0]));

        // Map JACK client names to display labels. Duplicate patcher names get the instance number.
        const nameCount = {};
        instances.forEach(([, inst]) => {
            const n = inst.CONTENTS.name.VALUE;
            nameCount[n] = (nameCount[n] || 0) + 1;
        });
        const clients = {};
        instances.forEach(([id, inst]) => {
            const c = inst.CONTENTS;
            const alias = c.config?.CONTENTS?.name_alias?.VALUE;
            const base = alias || c.name.VALUE;
            const label = nameCount[c.name.VALUE] > 1 && !alias ? `${base} ${id}` : base;
            const jackName = c.jack?.CONTENTS?.name?.VALUE || `${c.name.VALUE}-${id}`;
            clients[jackName] = { id, label, jackName };
        });
        const globalAudio = rnbo?.CONTENTS?.jack?.CONTENTS?.connections?.CONTENTS?.audio?.CONTENTS;

        const fragment = document.createDocumentFragment();
        instances.forEach(([id, instance]) => {
            const c = instance.CONTENTS;
            const jackName = c.jack?.CONTENTS?.name?.VALUE || `${c.name.VALUE}-${id}`;
            const card = el('section', 'card');
            card.id = `inst-${id}`;

            const header = el('header', 'card-header');
            header.appendChild(el('h2', 'card-title', clients[jackName].label));
            header.appendChild(el('span', 'card-badge', `#${id}`));
            card.appendChild(header);

            const routing = el('div', 'routing');
            routing.appendChild(routingRow('From', routingPeers(instance, jackName, 'in', globalAudio, clients)));
            routing.appendChild(routingRow('To', routingPeers(instance, jackName, 'out', globalAudio, clients)));
            card.appendChild(routing);

            const items = [];
            Object.entries(c.params?.CONTENTS || {}).forEach(([pid, p]) => items.push(buildParam(pid, p)));
            Object.entries(c.messages?.CONTENTS?.in?.CONTENTS || {}).forEach(([mid, m]) => items.push(buildInport(mid, m)));
            Object.entries(c.data_refs?.CONTENTS || {}).forEach(([did, d]) => items.push(buildDataRef(did, d, filenames)));

            const controls = el('div', 'card-controls');
            const visible = items.filter(Boolean).sort(compareItems);
            if (visible.length === 0) controls.appendChild(el('p', 'card-empty', 'No controls'));
            // Consecutive buttons share a row so transport controls sit together.
            let strip = null;
            visible.forEach(item => {
                const compact = item.el.classList.contains('control-button');
                if (compact) {
                    if (!strip) {
                        strip = el('div', 'button-strip');
                        controls.appendChild(strip);
                    }
                    strip.appendChild(item.el);
                } else {
                    strip = null;
                    controls.appendChild(item.el);
                }
            });
            card.appendChild(controls);
            fragment.appendChild(card);
        });

        grid.replaceChildren(fragment);
        setStatus(`${instances.length} instances · ${new Date().toLocaleTimeString()}`);
    }

    window.generateControls = generateControls;
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('refreshButton').addEventListener('click', generateControls);
        generateControls();
    });
})();
