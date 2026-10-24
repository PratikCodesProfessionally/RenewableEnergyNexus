/* ==========================================================================
 * GreenHub Copilot: charts
 *
 * Small SVG chart set (and one canvas heatmap) written for this page:
 *   stackedColumns  monthly energy balances
 *   lines           a day's profile, state of charge, scenario comparison
 *   signedColumns   cumulative cash flow (diverging around zero)
 *   heatmap         8760-hour carpet plot
 *
 * Conventions: bars <= 24 px with a 4 px rounded data-end and a 2 px surface
 * gap between touching segments; lines 2 px; hairline recessive grid; one
 * tooltip per chart listing every series (values lead, labels follow); marks
 * and columns are keyboard-focusable. Labels are inserted with textContent.
 * Colours come from CSS custom properties on .pvs-root.
 * ========================================================================== */
(function (root) {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    function compact(v) {
        const a = Math.abs(v);
        if (a >= 1e6) return nf1.format(v / 1e6).replace(/\.0$/, '') + 'M';
        if (a >= 1000) return nf1.format(v / 1000).replace(/\.0$/, '') + 'K';
        if (a > 0 && a < 10 && Math.round(v) !== v) return nf1.format(v);
        return nf0.format(v);
    }

    function el(name, attrs, parent) {
        const node = document.createElementNS(SVG_NS, name);
        Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, attrs[k]));
        if (parent) parent.appendChild(node);
        return node;
    }

    function text(parent, x, y, str, attrs) {
        const t = el('text', Object.assign({ x, y }, attrs || {}), parent);
        t.textContent = str;
        return t;
    }

    function cssVar(node, name, fallback) {
        const v = getComputedStyle(node).getPropertyValue(name).trim();
        return v || fallback;
    }

    // Round axis maximum to a clean step and return the ticks.
    function niceTicks(min, max, count) {
        if (max === min) max = min + 1;
        const span = max - min;
        const raw = span / Math.max(1, count);
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const norm = raw / mag;
        const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
        const lo = Math.floor(min / step) * step;
        const hi = Math.ceil(max / step) * step;
        const ticks = [];
        for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
        return { lo, hi, ticks };
    }

    // Path for a rect with only its data-end rounded (top for positive, bottom for negative).
    function barPath(x, y, w, h, r, roundTop) {
        if (h <= 0 || w <= 0) return '';
        const rr = Math.min(r, h, w / 2);
        if (roundTop) {
            return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
        }
        return `M${x},${y}V${y + h - rr}Q${x},${y + h} ${x + rr},${y + h}H${x + w - rr}Q${x + w},${y + h} ${x + w},${y + h - rr}V${y}Z`;
    }

    /* ------------------------------------------------------------------ *
     * Shared frame: resize handling, tooltip, legend                      *
     * ------------------------------------------------------------------ */

    function frame(container, opts, draw) {
        container.classList.add('pvs-chart');
        container.textContent = '';

        const legend = document.createElement('div');
        legend.className = 'pvs-legend';
        const plot = document.createElement('div');
        plot.className = 'pvs-plot';
        const tip = document.createElement('div');
        tip.className = 'pvs-tooltip';
        tip.setAttribute('role', 'status');
        tip.hidden = true;

        if (opts.legend && opts.legend.length > 1) container.appendChild(legend);
        container.appendChild(plot);
        plot.appendChild(tip);

        (opts.legend || []).forEach((item) => {
            if (opts.legend.length < 2) return;
            const span = document.createElement('span');
            span.className = 'pvs-legend-item';
            const key = document.createElement('span');
            key.className = 'pvs-key ' + (item.shape === 'line' ? 'pvs-key-line' : 'pvs-key-rect');
            key.style.background = item.color;
            const label = document.createElement('span');
            label.textContent = item.label;
            span.appendChild(key);
            span.appendChild(label);
            legend.appendChild(span);
        });

        const state = { width: 0 };

        function render() {
            const width = Math.max(260, Math.floor(plot.clientWidth));
            if (width === state.width && !state.force) return;
            state.width = width;
            state.force = false;
            Array.from(plot.querySelectorAll('svg, canvas')).forEach((n) => n.remove());
            draw(plot, width, tip);
        }

        if (container._pvsObserver) container._pvsObserver.disconnect();
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => render());
            ro.observe(plot);
            container._pvsObserver = ro;
        }
        state.force = true;
        render();
    }

    // Tooltip rows: value first (strong), then a line key and the label.
    function showTip(tip, plot, title, rows, x, y) {
        tip.textContent = '';
        if (title) {
            const h = document.createElement('div');
            h.className = 'pvs-tip-title';
            h.textContent = title;
            tip.appendChild(h);
        }
        rows.forEach((r) => {
            const row = document.createElement('div');
            row.className = 'pvs-tip-row';
            if (r.color) {
                const k = document.createElement('span');
                k.className = 'pvs-tip-key';
                k.style.background = r.color;
                row.appendChild(k);
            }
            const v = document.createElement('strong');
            v.textContent = r.value;
            const l = document.createElement('span');
            l.textContent = r.label;
            row.appendChild(v);
            row.appendChild(l);
            tip.appendChild(row);
        });
        tip.hidden = false;
        const pw = plot.clientWidth;
        const tw = tip.offsetWidth;
        const left = x + 14 + tw > pw ? Math.max(4, x - 14 - tw) : x + 14;
        tip.style.left = left + 'px';
        tip.style.top = Math.max(4, y - 10) + 'px';
    }

    function hideTip(tip) { tip.hidden = true; }

    function yAxis(svg, ticks, scaleY, left, right, fmt, colors) {
        ticks.forEach((t) => {
            const y = scaleY(t);
            el('line', { x1: left, x2: right, y1: y, y2: y, stroke: t === 0 ? colors.axis : colors.grid, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, svg);
            text(svg, left - 8, y + 4, fmt(t), { 'text-anchor': 'end', class: 'pvs-tick' });
        });
    }

    function colorsFor(node) {
        return {
            surface: cssVar(node, '--surface-1', '#1a1a19'),
            grid: cssVar(node, '--grid', '#2c2c2a'),
            axis: cssVar(node, '--axis', '#383835'),
            muted: cssVar(node, '--text-muted', '#898781')
        };
    }

    /* ------------------------------------------------------------------ *
     * Stacked columns                                                     *
     * ------------------------------------------------------------------ */

    function stackedColumns(container, opts) {
        const series = opts.series.filter((s) => s.values.some((v) => v > 0.0001) || s.always);
        frame(container, Object.assign({}, opts, {
            legend: series.map((s) => ({ label: s.label, color: s.color, shape: 'rect' }))
        }), (plot, width, tip) => {
            const height = opts.height || 260;
            const m = { top: 12, right: 12, bottom: 28, left: 52 };
            const colors = colorsFor(container);
            const svg = el('svg', { width, height, role: 'img', 'aria-label': opts.ariaLabel || '' }, plot);

            const n = opts.categories.length;
            const totals = opts.categories.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i]), 0));
            const refMax = opts.referenceLine ? Math.max(...opts.referenceLine.values) : 0;
            const { hi, ticks } = niceTicks(0, Math.max(1, ...totals, refMax), 5);
            const innerW = width - m.left - m.right;
            const innerH = height - m.top - m.bottom;
            const sy = (v) => m.top + innerH - (v / hi) * innerH;
            const band = innerW / n;
            const bw = Math.min(24, band * 0.62);

            yAxis(svg, ticks, sy, m.left, width - m.right, (t) => compact(t), colors);

            const GAP = 2;
            opts.categories.forEach((cat, i) => {
                const cx = m.left + band * i + band / 2;
                const x = cx - bw / 2;
                let base = 0;
                const visible = series.filter((s) => s.values[i] > 0.0001);
                visible.forEach((s, k) => {
                    const v = s.values[i];
                    const y0 = sy(base);
                    const y1 = sy(base + v);
                    const isTop = k === visible.length - 1;
                    // the 2 px surface gap sits between touching segments
                    const h = Math.max(0, (y0 - y1) - (k > 0 ? GAP : 0));
                    const yTop = y1;
                    if (h > 0.2) {
                        el('path', { d: barPath(x, yTop, bw, h, isTop ? 4 : 0, true), fill: s.color }, svg);
                    }
                    base += v;
                });
                text(svg, cx, height - 8, cat, { 'text-anchor': 'middle', class: 'pvs-tick' });

                // hit target: the whole band
                const hit = el('rect', {
                    x: m.left + band * i, y: m.top, width: band, height: innerH,
                    fill: 'transparent', tabindex: 0, class: 'pvs-hit',
                    'aria-label': `${cat}: ` + series.map((s) => `${s.label} ${nf0.format(s.values[i])} ${opts.unit}`).join(', ')
                }, svg);
                const show = (evt) => {
                    hit.setAttribute('fill', 'rgba(255,255,255,0.04)');
                    const rows = series.slice().reverse().map((s) => ({ color: s.color, value: `${nf0.format(s.values[i])} ${opts.unit}`, label: s.label }));
                    if (opts.referenceLine) rows.push({ color: opts.referenceLine.color, value: `${nf0.format(opts.referenceLine.values[i])} ${opts.unit}`, label: opts.referenceLine.label });
                    const rect = plot.getBoundingClientRect();
                    const px = evt && evt.clientX ? evt.clientX - rect.left : cx;
                    const py = evt && evt.clientY ? evt.clientY - rect.top : sy(totals[i]);
                    showTip(tip, plot, opts.categoryTitles ? opts.categoryTitles[i] : cat, rows, px, py);
                };
                hit.addEventListener('pointermove', show);
                hit.addEventListener('focus', () => show(null));
                hit.addEventListener('pointerleave', () => { hit.setAttribute('fill', 'transparent'); hideTip(tip); });
                hit.addEventListener('blur', () => { hit.setAttribute('fill', 'transparent'); hideTip(tip); });
            });

            if (opts.referenceLine) {
                // a dashed-free step line marking the reference (e.g. consumption) per month
                const pts = opts.referenceLine.values.map((v, i) => {
                    const cx = m.left + band * i + band / 2;
                    return `${cx - bw / 2 - 4},${sy(v)} ${cx + bw / 2 + 4},${sy(v)}`;
                });
                pts.forEach((seg) => {
                    el('polyline', { points: seg, fill: 'none', stroke: opts.referenceLine.color, 'stroke-width': 2, 'stroke-linecap': 'round' }, svg);
                });
            }
        });
    }

    /* ------------------------------------------------------------------ *
     * Lines with crosshair                                                *
     * ------------------------------------------------------------------ */

    function lines(container, opts) {
        const series = opts.series;
        frame(container, Object.assign({}, opts, {
            legend: series.map((s) => ({ label: s.label, color: s.color, shape: 'line' }))
        }), (plot, width, tip) => {
            const height = opts.height || 240;
            const m = { top: 14, right: opts.endLabels ? 96 : 14, bottom: 28, left: 52 };
            const colors = colorsFor(container);
            const svg = el('svg', { width, height, role: 'img', 'aria-label': opts.ariaLabel || '' }, plot);

            const xs = opts.x;
            const n = xs.length;
            let yMin = opts.yMin != null ? opts.yMin : Math.min(0, ...series.map((s) => Math.min(...s.values)));
            let yMax = opts.yMax != null ? opts.yMax : Math.max(...series.map((s) => Math.max(...s.values)));
            if (yMax <= yMin) yMax = yMin + 1;
            const nt = niceTicks(yMin, yMax, 5);
            const lo = opts.yMin != null ? opts.yMin : nt.lo;
            const hi = opts.yMax != null ? opts.yMax : nt.hi;
            const ticks = opts.yMax != null ? niceTicks(lo, hi, 4).ticks.filter((t) => t >= lo && t <= hi) : nt.ticks;

            const innerW = width - m.left - m.right;
            const innerH = height - m.top - m.bottom;
            const sx = (i) => m.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
            const sy = (v) => m.top + innerH - ((v - lo) / (hi - lo)) * innerH;

            yAxis(svg, ticks, sy, m.left, width - m.right, opts.yFormat || compact, colors);

            const xTickEvery = opts.xTickEvery || Math.max(1, Math.round(n / 6));
            xs.forEach((xv, i) => {
                if (i % xTickEvery !== 0 && i !== n - 1) return;
                // keep the outermost labels inside the plot instead of half-clipped
                const anchor = i === n - 1 && n > 1 ? 'end' : 'middle';
                text(svg, sx(i), height - 8, opts.xFormat ? opts.xFormat(xv, i) : String(xv), { 'text-anchor': anchor, class: 'pvs-tick' });
            });

            series.forEach((s) => {
                const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
                if (s.area) {
                    const base = sy(Math.max(lo, 0));
                    el('path', { d: `${d}L${sx(n - 1)},${base}L${sx(0)},${base}Z`, fill: s.color, 'fill-opacity': 0.1, stroke: 'none' }, svg);
                }
                el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
            });

            // end labels when they don't collide; otherwise the legend carries identity
            if (opts.endLabels) {
                const ends = series.map((s) => ({ s, y: sy(s.values[n - 1]) })).sort((a, b) => a.y - b.y);
                const collide = ends.some((e, i) => i > 0 && Math.abs(e.y - ends[i - 1].y) < 14);
                if (!collide) {
                    ends.forEach((e) => {
                        el('circle', { cx: sx(n - 1), cy: e.y, r: 4, fill: e.s.color, stroke: colors.surface, 'stroke-width': 2 }, svg);
                        text(svg, sx(n - 1) + 10, e.y + 4, e.s.endLabel || e.s.label, { class: 'pvs-endlabel' });
                    });
                }
            }

            (opts.markers || []).forEach((mk) => {
                const x = sx(mk.index);
                el('line', { x1: x, x2: x, y1: m.top, y2: m.top + innerH, stroke: colors.axis, 'stroke-width': 1 }, svg);
                text(svg, x + 6, m.top + 12, mk.label, { class: 'pvs-annot' });
            });

            const cross = el('line', { x1: 0, x2: 0, y1: m.top, y2: m.top + innerH, stroke: colors.muted, 'stroke-width': 1, visibility: 'hidden' }, svg);
            const dots = series.map((s) => el('circle', { r: 4, fill: s.color, stroke: colors.surface, 'stroke-width': 2, visibility: 'hidden' }, svg));
            const overlay = el('rect', {
                x: m.left, y: m.top, width: innerW, height: innerH, fill: 'transparent', tabindex: 0,
                class: 'pvs-hit', 'aria-label': (opts.ariaLabel || 'Chart') + '. Use left and right arrow keys to read values.'
            }, svg);

            let focusIdx = n - 1;
            const showAt = (i, px, py) => {
                i = Math.max(0, Math.min(n - 1, i));
                focusIdx = i;
                const x = sx(i);
                cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
                series.forEach((s, k) => {
                    dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', sy(s.values[i])); dots[k].setAttribute('visibility', 'visible');
                });
                const rows = series
                    .map((s) => ({ color: s.color, value: (opts.valueFormat || ((v) => nf1.format(v)))(s.values[i]) + (opts.unit ? ' ' + opts.unit : ''), label: s.label, raw: s.values[i] }))
                    .sort((a, b) => b.raw - a.raw);
                showTip(tip, plot, opts.xFormatLong ? opts.xFormatLong(xs[i], i) : (opts.xFormat ? opts.xFormat(xs[i], i) : String(xs[i])), rows, px != null ? px : x, py != null ? py : m.top + 20);
            };
            const hide = () => {
                cross.setAttribute('visibility', 'hidden');
                dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
                hideTip(tip);
            };
            overlay.addEventListener('pointermove', (evt) => {
                const rect = svg.getBoundingClientRect();
                const px = evt.clientX - rect.left;
                const i = Math.round(((px - m.left) / innerW) * (n - 1));
                showAt(i, px, evt.clientY - rect.top);
            });
            overlay.addEventListener('pointerleave', hide);
            overlay.addEventListener('focus', () => showAt(focusIdx));
            overlay.addEventListener('blur', hide);
            overlay.addEventListener('keydown', (evt) => {
                if (evt.key === 'ArrowRight') { showAt(focusIdx + 1); evt.preventDefault(); }
                if (evt.key === 'ArrowLeft') { showAt(focusIdx - 1); evt.preventDefault(); }
            });
        });
    }

    /* ------------------------------------------------------------------ *
     * Signed columns (diverging around zero)                              *
     * ------------------------------------------------------------------ */

    function signedColumns(container, opts) {
        frame(container, Object.assign({}, opts, {
            legend: [
                { label: opts.negLabel, color: opts.negColor, shape: 'rect' },
                { label: opts.posLabel, color: opts.posColor, shape: 'rect' }
            ]
        }), (plot, width, tip) => {
            const height = opts.height || 260;
            const m = { top: 22, right: 12, bottom: 28, left: 58 };
            const colors = colorsFor(container);
            const svg = el('svg', { width, height, role: 'img', 'aria-label': opts.ariaLabel || '' }, plot);
            const vals = opts.values;
            const n = vals.length;
            const { lo, hi, ticks } = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
            const innerW = width - m.left - m.right;
            const innerH = height - m.top - m.bottom;
            const sy = (v) => m.top + innerH - ((v - lo) / (hi - lo)) * innerH;
            const band = innerW / n;
            const bw = Math.min(24, Math.max(3, band - 2));

            yAxis(svg, ticks, sy, m.left, width - m.right, (t) => compact(t), colors);

            const every = n > 20 ? 5 : n > 10 ? 2 : 1;
            vals.forEach((v, i) => {
                const cx = m.left + band * i + band / 2;
                const y0 = sy(0);
                const y1 = sy(v);
                const color = v >= 0 ? opts.posColor : opts.negColor;
                if (Math.abs(y1 - y0) > 0.2) {
                    el('path', { d: barPath(cx - bw / 2, Math.min(y0, y1), bw, Math.abs(y1 - y0), 4, v >= 0), fill: color }, svg);
                }
                if (i % every === 0 || i === n - 1) text(svg, cx, height - 8, opts.categories[i], { 'text-anchor': 'middle', class: 'pvs-tick' });

                const hit = el('rect', {
                    x: m.left + band * i, y: m.top, width: band, height: innerH, fill: 'transparent', tabindex: 0, class: 'pvs-hit',
                    'aria-label': `${opts.categoryTitle ? opts.categoryTitle(i) : opts.categories[i]}: ${opts.valueFormat(v)}`
                }, svg);
                const show = (evt) => {
                    hit.setAttribute('fill', 'rgba(255,255,255,0.04)');
                    const rect = plot.getBoundingClientRect();
                    showTip(tip, plot, opts.categoryTitle ? opts.categoryTitle(i) : opts.categories[i],
                        [{ color, value: opts.valueFormat(v), label: opts.valueLabel }].concat(opts.extraRows ? opts.extraRows(i) : []),
                        evt && evt.clientX ? evt.clientX - rect.left : cx, evt && evt.clientY ? evt.clientY - rect.top : y1);
                };
                hit.addEventListener('pointermove', show);
                hit.addEventListener('focus', () => show(null));
                hit.addEventListener('pointerleave', () => { hit.setAttribute('fill', 'transparent'); hideTip(tip); });
                hit.addEventListener('blur', () => { hit.setAttribute('fill', 'transparent'); hideTip(tip); });
            });

            if (opts.marker && opts.marker.position != null) {
                const x = m.left + band * opts.marker.position + band / 2;
                el('line', { x1: x, x2: x, y1: m.top - 6, y2: sy(0), stroke: cssVar(container, '--text-secondary', '#c3c2b7'), 'stroke-width': 1 }, svg);
                const anchor = x > width - 140 ? 'end' : 'start';
                text(svg, anchor === 'end' ? x - 6 : x + 6, m.top + 2, opts.marker.label, { class: 'pvs-annot', 'text-anchor': anchor });
            }
        });
    }

    /* ------------------------------------------------------------------ *
     * Heatmap (canvas, 365 x 24)                                          *
     * ------------------------------------------------------------------ */

    const BLUE_RAMP = ['#1a1a19', '#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];

    function hexToRgb(h) {
        const n = parseInt(h.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const RAMP_RGB = BLUE_RAMP.map(hexToRgb);

    function rampColor(t) {
        const x = Math.max(0, Math.min(1, t)) * (RAMP_RGB.length - 1);
        const i = Math.floor(x);
        const f = x - i;
        const a = RAMP_RGB[i];
        const b = RAMP_RGB[Math.min(RAMP_RGB.length - 1, i + 1)];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }

    function heatmap(container, opts) {
        frame(container, Object.assign({}, opts, { legend: [] }), (plot, width, tip) => {
            const m = { top: 8, right: 12, bottom: 54, left: 40 };
            const height = opts.height || 300;
            const innerW = width - m.left - m.right;
            const innerH = height - m.top - m.bottom;
            const days = 365;
            const dpr = Math.min(2, window.devicePixelRatio || 1);

            const canvas = document.createElement('canvas');
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            canvas.setAttribute('role', 'img');
            canvas.setAttribute('aria-label', opts.ariaLabel || '');
            canvas.tabIndex = 0;
            plot.appendChild(canvas);
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);

            const max = opts.max || Math.max(...opts.values) || 1;
            const cw = innerW / days;
            const ch = innerH / 24;
            for (let d = 0; d < days; d++) {
                for (let h = 0; h < 24; h++) {
                    const v = opts.values[d * 24 + opts.hourIndex(h, d)];
                    const c = rampColor(v / max);
                    ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
                    // y: hour 0 at the top, noon in the middle
                    ctx.fillRect(m.left + d * cw, m.top + h * ch, Math.ceil(cw + 0.5), Math.ceil(ch + 0.5));
                }
            }

            const muted = cssVar(container, '--text-muted', '#898781');
            ctx.fillStyle = muted;
            ctx.font = '11px Inter, system-ui, sans-serif';
            ctx.textAlign = 'right';
            [0, 6, 12, 18, 24].forEach((h) => ctx.fillText(String(h).padStart(2, '0') + ':00', m.left - 6, m.top + h * ch + 4));
            ctx.textAlign = 'center';
            const monthStart = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
            const mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            monthStart.forEach((doy, i) => {
                const next = i < 11 ? monthStart[i + 1] : 366;
                ctx.fillText(mn[i], m.left + ((doy - 1 + next - 1) / 2) * cw, m.top + innerH + 14);
            });

            // legend ramp with ticks
            const lx = m.left;
            const ly = height - 22;
            const lw = Math.min(220, innerW * 0.5);
            const grad = ctx.createLinearGradient(lx, 0, lx + lw, 0);
            BLUE_RAMP.forEach((c, i) => grad.addColorStop(i / (BLUE_RAMP.length - 1), c));
            ctx.fillStyle = grad;
            ctx.fillRect(lx, ly, lw, 8);
            ctx.fillStyle = muted;
            ctx.textAlign = 'left';
            ctx.fillText('0', lx, ly + 20);
            ctx.textAlign = 'right';
            ctx.fillText(`${nf1.format(max)} ${opts.unit}`, lx + lw, ly + 20);
            ctx.textAlign = 'left';
            ctx.fillText(opts.legendLabel || '', lx + lw + 12, ly + 8);

            let focus = { d: 171, h: 12 };
            const show = (d, h, px, py) => {
                d = Math.max(0, Math.min(days - 1, d));
                h = Math.max(0, Math.min(23, h));
                focus = { d, h };
                const v = opts.values[d * 24 + opts.hourIndex(h, d)];
                showTip(tip, plot, opts.cellTitle(d, h), [{ value: `${nf1.format(v)} ${opts.unit}`, label: opts.valueLabel }],
                    px != null ? px : m.left + d * cw, py != null ? py : m.top + h * ch);
            };
            canvas.addEventListener('pointermove', (evt) => {
                const rect = canvas.getBoundingClientRect();
                const px = evt.clientX - rect.left;
                const py = evt.clientY - rect.top;
                if (px < m.left || px > m.left + innerW || py < m.top || py > m.top + innerH) { hideTip(tip); return; }
                show(Math.floor((px - m.left) / cw), Math.floor((py - m.top) / ch), px, py);
            });
            canvas.addEventListener('pointerleave', () => hideTip(tip));
            canvas.addEventListener('focus', () => show(focus.d, focus.h));
            canvas.addEventListener('blur', () => hideTip(tip));
            canvas.addEventListener('keydown', (evt) => {
                const k = evt.key;
                if (k === 'ArrowRight') show(focus.d + 1, focus.h);
                else if (k === 'ArrowLeft') show(focus.d - 1, focus.h);
                else if (k === 'ArrowUp') show(focus.d, focus.h - 1);
                else if (k === 'ArrowDown') show(focus.d, focus.h + 1);
                else return;
                evt.preventDefault();
            });
        });
    }

    /* ------------------------------------------------------------------ *
     * Table view                                                          *
     * ------------------------------------------------------------------ */

    function table(container, columns, rows) {
        container.textContent = '';
        const wrap = document.createElement('div');
        wrap.className = 'pvs-table-wrap';
        const t = document.createElement('table');
        t.className = 'pvs-table';
        const thead = document.createElement('thead');
        const hr = document.createElement('tr');
        columns.forEach((c) => {
            const th = document.createElement('th');
            th.scope = 'col';
            th.textContent = c;
            hr.appendChild(th);
        });
        thead.appendChild(hr);
        t.appendChild(thead);
        const tbody = document.createElement('tbody');
        rows.forEach((r) => {
            const tr = document.createElement('tr');
            r.forEach((cell, i) => {
                const td = document.createElement(i === 0 ? 'th' : 'td');
                if (i === 0) td.scope = 'row';
                td.textContent = cell;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        t.appendChild(tbody);
        wrap.appendChild(t);
        container.appendChild(wrap);
    }

    root.PVSimCharts = { stackedColumns, lines, signedColumns, heatmap, table, compact, rampColor };
})(typeof window !== 'undefined' ? window : this);
