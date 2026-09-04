/* ====================================================================
   Presentation Mode
   --------------------------------------------------------------------
   Turns each ".energy-card" in the education section into a slide deck.
   The slides are generated from the card's existing ".energy-content"
   markup, so the HTML stays the single source of truth (and remains
   readable for search engines and no-JS visitors).
   ==================================================================== */
(function () {
    'use strict';

    // --- Theming and cover artwork per energy type -------------------
    var ART = {
        campus: 'Images/ImageforPowerpointGeminiGenerated.jpg',
        hydro: 'Images/HydropowerGeminiGenerated.jpg',
        hydrogen: 'Images/GreenHydrogenGeminiGenerated.jpg'
    };

    var THEMES = {
        'solar-energy':    { key: 'solar',    accent: '#f7b733', accent2: '#f2591f', art: ART.campus },
        'wind-energy':     { key: 'wind',     accent: '#57b8ff', accent2: '#1d5fa8', art: ART.campus },
        'hydropower':      { key: 'hydro',    accent: '#31c6dd', accent2: '#0a6a8c', art: ART.hydro },
        'green-hydrogen':  { key: 'hydrogen', accent: '#5ed17c', accent2: '#12703c', art: ART.hydrogen },
        'global-projects': { key: 'map',      accent: '#9b8bf4', accent2: '#4634ac', art: ART.campus }
    };
    var DEFAULT_THEME = { key: 'default', accent: '#4CAF50', accent2: '#1b5e20', art: ART.campus };

    // Roughly how much "visual weight" one slide can carry before we
    // start a continuation slide. Tuned against the longest sections.
    var SLIDE_BUDGET = 6.4;
    var LIST_BUDGET = 6.0;

    var decks = {};          // card id -> deck object
    var overlay = null;      // the viewer root element
    var state = { deck: null, index: 0, outlineOpen: false };
    var mapHome = null;      // { parent, next } so #projects-map can go back
    var lastFocus = null;

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------
    function text(node) {
        return (node && node.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function words(str) {
        return str ? str.split(' ').length : 0;
    }

    function esc(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function firstSentence(str, max) {
        max = max || 190;
        var cut = str.indexOf('. ');
        var out = cut > 40 ? str.slice(0, cut + 1) : str;
        if (out.length > max) out = out.slice(0, max).replace(/\s+\S*$/, '') + '…';
        return out;
    }

    // -----------------------------------------------------------------
    // Building blocks ("units") extracted from the source markup
    // -----------------------------------------------------------------
    function paragraphUnit(p) {
        var body = text(p);
        return {
            kind: 'text',
            html: '<p>' + p.innerHTML + '</p>',
            weight: 0.9 + words(body) / 45,
            // A short line ending in a colon introduces the list that
            // follows, so it must never be stranded at the end of a slide.
            leadIn: /:$/.test(body) && words(body) < 12
        };
    }

    function itemWeight(li) {
        return 0.85 + li.querySelectorAll('li').length * 0.8 + words(text(li)) / 55;
    }

    function listChunk(source, items) {
        var list = document.createElement(source.tagName);
        var weight = 0;
        items.forEach(function (li) {
            list.appendChild(li.cloneNode(true));
            weight += itemWeight(li);
        });
        return { kind: 'list', html: list.outerHTML, weight: weight };
    }

    // Long bullet lists become several slides rather than one scrolling wall.
    function listUnits(list) {
        var items = Array.prototype.filter.call(list.children, function (n) {
            return n.tagName === 'LI';
        });
        var units = [];
        var buffer = [];
        var weight = 0;

        items.forEach(function (li) {
            var w = itemWeight(li);
            if (buffer.length && weight + w > LIST_BUDGET) {
                units.push(listChunk(list, buffer));
                buffer = [];
                weight = 0;
            }
            buffer.push(li);
            weight += w;
        });
        if (buffer.length) units.push(listChunk(list, buffer));
        return units;
    }

    // Each case study gets a slide of its own, rendered as a fact sheet.
    function projectUnit(item) {
        var heading = item.querySelector('h5');
        var name = heading ? text(heading) : 'Project';
        var rows = '';

        Array.prototype.forEach.call(item.querySelectorAll('p'), function (p) {
            var strong = p.querySelector('strong');
            if (!strong) {
                rows += '<div class="deck-fact deck-fact--wide"><div class="deck-fact__value">' +
                        p.innerHTML + '</div></div>';
                return;
            }
            var label = text(strong).replace(/:\s*$/, '');
            var clone = p.cloneNode(true);
            clone.removeChild(clone.querySelector('strong'));
            var value = clone.innerHTML.replace(/^\s*:?\s*/, '');
            var wide = /impact|partner/i.test(label) || value.length > 130;
            rows += '<div class="deck-fact' + (wide ? ' deck-fact--wide' : '') + '">' +
                        '<div class="deck-fact__label">' + esc(label) + '</div>' +
                        '<div class="deck-fact__value">' + value + '</div>' +
                    '</div>';
        });

        return {
            kind: 'project',
            solo: true,
            name: name,
            html: '<div class="deck-facts">' + rows + '</div>'
        };
    }

    function tableUnit(node) {
        var table = node.tagName === 'TABLE' ? node : node.querySelector('table');
        if (!table) return null;
        return {
            kind: 'table',
            solo: true,
            html: '<div class="deck-table">' + table.outerHTML + '</div>'
        };
    }

    // -----------------------------------------------------------------
    // Source markup -> sections -> slides
    // -----------------------------------------------------------------
    function readSections(content) {
        var sections = [];
        var current = { title: 'Overview', units: [] };

        Array.prototype.forEach.call(content.children, function (node) {
            var tag = node.tagName;

            if (tag === 'H4') {
                if (current.units.length) sections.push(current);
                current = { title: text(node), units: [] };
                return;
            }
            if (tag === 'P') {
                current.units.push(paragraphUnit(node));
                return;
            }
            if (tag === 'UL' || tag === 'OL') {
                listUnits(node).forEach(function (u) { current.units.push(u); });
                return;
            }
            if (node.classList.contains('project-showcase')) {
                Array.prototype.forEach.call(node.querySelectorAll('.project-item'), function (item) {
                    current.units.push(projectUnit(item));
                });
                return;
            }
            if (node.classList.contains('hydrogen-comparison') || tag === 'TABLE') {
                // The wrapper carries its own <h4>; promote it to a section.
                var inner = node.querySelector('h4');
                if (inner) {
                    if (current.units.length) sections.push(current);
                    current = { title: text(inner).replace(/:\s*$/, ''), units: [] };
                }
                var unit = tableUnit(node);
                if (unit) current.units.push(unit);
                return;
            }
            if (node.id === 'projects-map') {
                current.units.push({
                    kind: 'map',
                    weight: 0,
                    html: '<div class="deck-map" data-map-holder></div>'
                });
            }
        });

        if (current.units.length) sections.push(current);
        return sections;
    }

    function slidesForSection(section) {
        var slides = [];
        var open = null;
        var weight = 0;

        function flush() {
            if (open && open.blocks.length) slides.push(open);
            open = null;
            weight = 0;
        }

        function ensureOpen() {
            if (!open) open = { type: 'content', title: section.title, blocks: [] };
        }

        section.units.forEach(function (unit) {
            if (unit.solo) {
                flush();
                slides.push({
                    type: unit.kind,
                    title: section.title,
                    subtitle: unit.name || '',
                    blocks: [unit]
                });
                return;
            }
            if (open && weight + unit.weight > SLIDE_BUDGET) flush();
            ensureOpen();
            open.blocks.push(unit);
            weight += unit.weight;
            if (unit.kind === 'map') open.type = 'map';
        });
        flush();

        // Move any stranded "Core Components:" style lead-in onto the slide
        // that carries the list it introduces.
        for (var i = 0; i < slides.length - 1; i++) {
            var blocks = slides[i].blocks;
            var last = blocks[blocks.length - 1];
            if (blocks.length > 1 && last.leadIn && slides[i + 1].type === 'content') {
                blocks.pop();
                slides[i + 1].blocks.unshift(last);
            }
        }

        return slides;
    }

    function buildDeck(card) {
        var content = card.querySelector('.energy-content');
        if (!content) return null;

        var title = text(card.querySelector('.energy-header h3'));
        var iconEl = card.querySelector('.energy-icon i');
        var sections = readSections(content);

        var overview = '';
        sections.some(function (section) {
            return section.units.some(function (unit) {
                if (unit.kind !== 'text') return false;
                var probe = document.createElement('div');
                probe.innerHTML = unit.html;
                overview = text(probe);
                return true;
            });
        });

        var deck = {
            id: card.id,
            title: title,
            tagline: card.getAttribute('data-deck-tagline') || firstSentence(overview),
            iconClass: iconEl ? iconEl.className : 'fas fa-bolt',
            theme: THEMES[card.id] || DEFAULT_THEME,
            sections: sections.map(function (s) { return s.title; }),
            slides: []
        };

        // Cover slide
        deck.slides.push({ type: 'cover', title: deck.title, section: '' });

        // Agenda slide (only worth showing when there is something to survey)
        if (sections.length > 2) {
            deck.slides.push({ type: 'agenda', title: 'What we will cover', section: 'Agenda' });
        }

        sections.forEach(function (section) {
            var built = slidesForSection(section);
            built.forEach(function (slide, idx) {
                slide.section = section.title;
                slide.continued = idx > 0 && slide.type === 'content';
                slide.partOf = built.length;
                slide.part = idx + 1;
                deck.slides.push(slide);
            });
        });

        deck.slides.push({ type: 'end', title: deck.title, section: '' });
        return deck;
    }

    // -----------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------
    function renderSlide(deck, slide, number) {
        if (slide.type === 'cover') {
            var art = deck.theme.art
                ? '<div class="deck-cover__art"><img src="' + esc(deck.theme.art) +
                      '" alt="" loading="eager"></div>'
                : '';
            return '<section class="deck-slide deck-slide--cover" data-type="cover">' +
                       '<div class="deck-cover">' +
                           '<div class="deck-cover__icon"><i class="' + esc(deck.iconClass) + '"></i></div>' +
                           '<p class="deck-cover__eyebrow">Understanding Renewable Energy</p>' +
                           '<h2 class="deck-cover__title">' + esc(deck.title) + '</h2>' +
                           '<p class="deck-cover__tagline">' + esc(deck.tagline) + '</p>' +
                           '<p class="deck-cover__meta">' + deck.slides.length + ' slides &middot; ' +
                               deck.sections.length + ' sections</p>' +
                       '</div>' + art +
                   '</section>';
        }

        if (slide.type === 'agenda') {
            var items = deck.sections.map(function (name, i) {
                return '<li><span class="deck-agenda__num">' +
                           (i + 1 < 10 ? '0' : '') + (i + 1) +
                       '</span><span>' + esc(name) + '</span></li>';
            }).join('');
            return '<section class="deck-slide" data-type="agenda">' +
                       '<div class="deck-slide__head">' +
                           '<p class="deck-slide__kicker">Agenda</p>' +
                           '<h2 class="deck-slide__title">' + esc(slide.title) + '</h2>' +
                       '</div>' +
                       '<div class="deck-slide__body"><ol class="deck-agenda">' + items + '</ol></div>' +
                   '</section>';
        }

        if (slide.type === 'end') {
            return '<section class="deck-slide deck-slide--cover" data-type="end">' +
                       '<div class="deck-cover deck-cover--end">' +
                           '<div class="deck-cover__icon"><i class="fas fa-leaf"></i></div>' +
                           '<h2 class="deck-cover__title">Thank you</h2>' +
                           '<p class="deck-cover__tagline">End of the ' + esc(deck.title) + ' briefing. ' +
                               'Use the savings calculator or request a consultation to apply it to your own project.</p>' +
                           '<p class="deck-cover__meta">Renewable Energy Nexus</p>' +
                       '</div>' +
                   '</section>';
        }

        var body = slide.blocks.map(function (b) { return b.html; }).join('');
        var kicker = slide.type === 'project' ? 'Case study'
                   : slide.type === 'map' ? 'Interactive map'
                   : deck.title;
        var heading = slide.type === 'project' ? slide.subtitle : slide.title;
        var sub = '';

        if (slide.type === 'project') {
            sub = '<p class="deck-slide__sub">' + esc(slide.section) + '</p>';
        } else if (slide.continued) {
            sub = '<p class="deck-slide__sub">continued (' + slide.part + ' of ' + slide.partOf + ')</p>';
        }

        return '<section class="deck-slide" data-type="' + esc(slide.type) + '">' +
                   '<div class="deck-slide__head">' +
                       '<p class="deck-slide__kicker">' + esc(kicker) + '</p>' +
                       '<h2 class="deck-slide__title">' + esc(heading) + '</h2>' + sub +
                   '</div>' +
                   '<div class="deck-slide__body">' + body + '</div>' +
                   '<div class="deck-slide__foot">' +
                       '<span>' + esc(deck.title) + '</span><span>' + number + '</span>' +
                   '</div>' +
               '</section>';
    }

    // Shrink a slide a little rather than letting it scroll on first sight.
    function fitSlide(stage) {
        var body = stage.querySelector('.deck-slide__body');
        if (!body) return;
        var steps = [1, 0.94, 0.88, 0.82, 0.76];
        var fits = false;
        for (var i = 0; i < steps.length; i++) {
            body.style.setProperty('--deck-scale', steps[i]);
            if (body.scrollHeight <= body.clientHeight + 2) { fits = true; break; }
        }
        body.classList.toggle('is-centered', fits);
    }

    // -----------------------------------------------------------------
    // Viewer
    // -----------------------------------------------------------------
    function buildOverlay() {
        overlay = document.createElement('div');
        overlay.className = 'deck-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Presentation');
        overlay.hidden = true;
        overlay.innerHTML =
            '<div class="deck-progress"><span></span></div>' +
            '<div class="deck-topbar">' +
                '<button type="button" class="deck-icon-btn" data-action="outline" aria-label="Toggle slide outline">' +
                    '<i class="fas fa-list-ul"></i></button>' +
                '<div class="deck-brand"><i class="deck-brand__icon"></i>' +
                    '<span class="deck-brand__title"></span></div>' +
                '<div class="deck-topbar__right">' +
                    '<button type="button" class="deck-icon-btn" data-action="print" aria-label="Print or save as PDF">' +
                        '<i class="fas fa-print"></i></button>' +
                    '<button type="button" class="deck-icon-btn" data-action="fullscreen" aria-label="Toggle fullscreen">' +
                        '<i class="fas fa-expand"></i></button>' +
                    '<button type="button" class="deck-icon-btn deck-icon-btn--close" data-action="close" aria-label="Close presentation">' +
                        '<i class="fas fa-times"></i></button>' +
                '</div>' +
            '</div>' +
            '<div class="deck-main">' +
                '<div class="deck-outline" role="navigation" aria-label="Slide outline"></div>' +
                '<div class="deck-stage-wrap">' +
                    '<button type="button" class="deck-arrow deck-arrow--prev" data-action="prev" aria-label="Previous slide">' +
                        '<i class="fas fa-chevron-left"></i></button>' +
                    '<div class="deck-stage" aria-live="polite"></div>' +
                    '<button type="button" class="deck-arrow deck-arrow--next" data-action="next" aria-label="Next slide">' +
                        '<i class="fas fa-chevron-right"></i></button>' +
                '</div>' +
            '</div>' +
            '<div class="deck-bottombar">' +
                '<button type="button" class="deck-btn" data-action="prev">' +
                    '<i class="fas fa-arrow-left"></i> Previous</button>' +
                '<div class="deck-dots" role="tablist" aria-label="Slides"></div>' +
                '<div class="deck-counter"><strong>1</strong> / <span>1</span></div>' +
                '<button type="button" class="deck-btn deck-btn--primary" data-action="next">' +
                    'Next <i class="fas fa-arrow-right"></i></button>' +
            '</div>';
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function (e) {
            var trigger = e.target.closest('[data-action]');
            if (!trigger) return;
            var action = trigger.getAttribute('data-action');
            if (action === 'close') closeDeck();
            else if (action === 'next') go(state.index + 1);
            else if (action === 'prev') go(state.index - 1);
            else if (action === 'goto') go(parseInt(trigger.getAttribute('data-index'), 10));
            else if (action === 'outline') toggleOutline();
            else if (action === 'fullscreen') toggleFullscreen();
            else if (action === 'print') printDeck();
        });

        document.addEventListener('keydown', onKeydown);
        document.addEventListener('fullscreenchange', syncFullscreenIcon);
        window.addEventListener('afterprint', teardownPrint);
    }

    function onKeydown(e) {
        if (!overlay || overlay.hidden) return;
        switch (e.key) {
            case 'ArrowRight':
            case 'PageDown':
            case ' ':
                e.preventDefault(); go(state.index + 1); break;
            case 'ArrowLeft':
            case 'PageUp':
                e.preventDefault(); go(state.index - 1); break;
            case 'Home':
                e.preventDefault(); go(0); break;
            case 'End':
                e.preventDefault(); go(state.deck.slides.length - 1); break;
            case 'Escape':
                e.preventDefault();
                if (document.fullscreenElement) document.exitFullscreen();
                else closeDeck();
                break;
            case 'f':
            case 'F':
                e.preventDefault(); toggleFullscreen(); break;
        }
    }

    // Printing renders the entire deck; the live map slide is skipped
    // because a Leaflet canvas cannot be duplicated.
    function printDeck() {
        var deck = state.deck;
        if (!deck) return;

        var wrap = overlay.querySelector('.deck-print');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.className = 'deck-print';
            overlay.appendChild(wrap);
        }
        wrap.innerHTML = deck.slides.map(function (slide, i) {
            if (slide.type === 'map') return '';
            return '<div class="deck-print-slide">' + renderSlide(deck, slide, i + 1) + '</div>';
        }).join('');

        overlay.classList.add('is-printing');
        window.print();
        setTimeout(teardownPrint, 800);
    }

    function teardownPrint() {
        if (!overlay) return;
        overlay.classList.remove('is-printing');
        var wrap = overlay.querySelector('.deck-print');
        if (wrap) wrap.innerHTML = '';
    }

    function toggleOutline() {
        state.outlineOpen = !state.outlineOpen;
        overlay.classList.toggle('is-outline-open', state.outlineOpen);
    }

    function toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else if (overlay.requestFullscreen) {
            overlay.requestFullscreen().catch(function () { /* user agent refused */ });
        }
    }

    function syncFullscreenIcon() {
        var icon = overlay && overlay.querySelector('[data-action="fullscreen"] i');
        if (!icon) return;
        icon.className = document.fullscreenElement ? 'fas fa-compress' : 'fas fa-expand';
    }

    function renderChrome(deck) {
        overlay.querySelector('.deck-brand__icon').className = 'deck-brand__icon ' + deck.iconClass;
        overlay.querySelector('.deck-brand__title').textContent = deck.title;
        overlay.style.setProperty('--deck-accent', deck.theme.accent);
        overlay.style.setProperty('--deck-accent-2', deck.theme.accent2);
        overlay.setAttribute('data-theme', deck.theme.key);

        overlay.querySelector('.deck-dots').innerHTML = deck.slides.map(function (s, i) {
            return '<button type="button" class="deck-dot" data-action="goto" data-index="' + i +
                   '" role="tab" aria-label="Slide ' + (i + 1) + ': ' +
                   esc(s.subtitle || s.title || s.section) + '"></button>';
        }).join('');

        var seen = {};
        overlay.querySelector('.deck-outline').innerHTML = deck.slides.map(function (s, i) {
            var label = s.type === 'cover' ? 'Title page'
                      : s.type === 'end' ? 'Closing'
                      : s.type === 'project' ? s.subtitle
                      : s.title + (s.partOf > 1 ? ' (' + s.part + '/' + s.partOf + ')' : '');
            var isSectionStart = !!s.section && !seen[s.section];
            if (s.section) seen[s.section] = true;
            return '<button type="button" class="deck-outline__item' +
                   (isSectionStart ? ' is-section' : '') +
                   '" data-action="goto" data-index="' + i + '">' +
                       '<span class="deck-outline__num">' + (i + 1) + '</span>' +
                       '<span class="deck-outline__label">' + esc(label) + '</span>' +
                   '</button>';
        }).join('');

        overlay.querySelector('.deck-counter span').textContent = deck.slides.length;
    }

    function go(index) {
        var deck = state.deck;
        if (!deck) return;
        index = Math.max(0, Math.min(deck.slides.length - 1, index));
        state.index = index;

        var slide = deck.slides[index];
        var stage = overlay.querySelector('.deck-stage');

        // Rewriting the stage would destroy the live map node, so park it
        // back in the markup before the slide is replaced.
        releaseMap();
        stage.innerHTML = renderSlide(deck, slide, index + 1);
        stage.classList.remove('is-entering');
        void stage.offsetWidth;                 // restart the entrance animation
        stage.classList.add('is-entering');

        if (slide.type === 'map') mountMap(stage);
        fitSlide(stage);

        overlay.querySelector('.deck-progress span').style.width =
            (index / Math.max(1, deck.slides.length - 1) * 100) + '%';
        overlay.querySelector('.deck-counter strong').textContent = index + 1;

        Array.prototype.forEach.call(overlay.querySelectorAll('.deck-dot'), function (dot, i) {
            dot.classList.toggle('is-active', i === index);
            dot.setAttribute('aria-selected', i === index ? 'true' : 'false');
        });

        var items = overlay.querySelectorAll('.deck-outline__item');
        Array.prototype.forEach.call(items, function (item, i) {
            item.classList.toggle('is-active', i === index);
        });
        if (items[index] && state.outlineOpen) {
            items[index].scrollIntoView({ block: 'nearest' });
        }

        var buttons = overlay.querySelectorAll('.deck-btn');
        overlay.querySelector('.deck-arrow--prev').disabled = index === 0;
        overlay.querySelector('.deck-arrow--next').disabled = index === deck.slides.length - 1;
        buttons[0].disabled = index === 0;
        buttons[1].disabled = index === deck.slides.length - 1;
    }

    // The Leaflet map is a live node: move it onto the slide, then home again.
    function mountMap(stage) {
        var holder = stage.querySelector('[data-map-holder]');
        var mapEl = document.getElementById('projects-map');
        if (!holder || !mapEl) return;

        if (!mapHome) {
            mapHome = { parent: mapEl.parentNode, next: mapEl.nextSibling };
        }
        holder.appendChild(mapEl);

        setTimeout(function () {
            if (typeof L === 'undefined') return;
            if (!mapEl._leaflet_id && typeof window.initMap === 'function') {
                window.initMap();
            } else if (window.map && window.map.invalidateSize) {
                window.map.invalidateSize();
            }
        }, 60);
    }

    function releaseMap() {
        if (!mapHome) return;
        var mapEl = document.getElementById('projects-map');
        if (mapEl && overlay.contains(mapEl)) {
            mapHome.parent.insertBefore(mapEl, mapHome.next);
        }
    }

    function openDeck(card) {
        if (!overlay) buildOverlay();

        var deck = decks[card.id];
        if (!deck) {
            deck = buildDeck(card);
            if (!deck) return;
            decks[card.id] = deck;
        }

        lastFocus = document.activeElement;
        state.deck = deck;
        renderChrome(deck);
        overlay.hidden = false;
        document.body.classList.add('deck-open');
        go(0);
        overlay.querySelector('[data-action="close"]').focus();

        // Keep the savings calculator in sync with the topic being read.
        var type = card.getAttribute('data-energy-type');
        var select = document.getElementById('energy-type');
        if (type && select) select.value = type;
    }

    function closeDeck() {
        if (!overlay || overlay.hidden) return;
        if (document.fullscreenElement) document.exitFullscreen();
        releaseMap();
        overlay.querySelector('.deck-stage').innerHTML = '';
        overlay.hidden = true;
        overlay.classList.remove('is-outline-open');
        state.outlineOpen = false;
        document.body.classList.remove('deck-open');
        state.deck = null;
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    // -----------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------
    function decorateCard(card) {
        if (card.querySelector('.energy-card__cta')) return;

        var deck = decks[card.id] || buildDeck(card);
        if (!deck) return;
        decks[card.id] = deck;

        card.style.setProperty('--card-accent', deck.theme.accent);
        card.style.setProperty('--card-accent-2', deck.theme.accent2);
        card.setAttribute('data-theme', deck.theme.key);
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Open the ' + deck.title + ' presentation');

        var blurb = document.createElement('p');
        blurb.className = 'energy-card__blurb';
        blurb.textContent = deck.tagline;

        var cta = document.createElement('div');
        cta.className = 'energy-card__cta';
        cta.innerHTML = '<span class="energy-card__count">' +
                            '<i class="fas fa-layer-group"></i> ' + deck.slides.length + ' slides</span>' +
                        '<span class="energy-card__open">Open presentation ' +
                            '<i class="fas fa-arrow-right"></i></span>';

        card.appendChild(blurb);
        card.appendChild(cta);

        card.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openDeck(card);
            }
        });
    }

    function init() {
        document.documentElement.classList.add('has-decks');
        Array.prototype.forEach.call(
            document.querySelectorAll('.education-section .energy-card'),
            decorateCard
        );
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Called from the markup.
    window.openPresentation = openDeck;
    window.closePresentation = closeDeck;
})();
