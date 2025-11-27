class TagsManager {
    constructor() {
        this.tagsData = null;
        this.selectedTags = new Map();
        this.categories = new Map();
        this.allTagsInOrder = [];
        this.tagIndexMap = new Map(); // Оптимизация поиска
        this.isHeaderPinned = true;
        this.dom = {}; // Кэш DOM
        this.initialize();
    }

    async initialize() {
        try {
            this.cacheDOM();
            if (await this.loadData()) {
                this.showUI();
                this.initCategories();
                this.setupEvents();
                this.render();
                this.parseInput(this.dom.input.value);
                this.updateState();
            } else {
                this.error('Неизвестная ошибка загрузки конфигурации');
            }
        } catch (e) {
            console.error(e);
            this.error(`Ошибка: ${e.message}`);
        }
    }

    cacheDOM() {
        const id = x => document.getElementById(x);
        this.dom = {
            loading: id('loadingMessage'),
            error: id('errorMessage'),
            errDetail: id('errorDetails'),
            app: id('appContainer'),
            input: id('tagsInput'),
            limitBox: id('limitCheckbox'),
            limitDisp: id('limitDisplay'),
            altSection: id('alternativeSection'),
            altOut: id('alternativeOutput'),
            dupBox: id('removeDuplicatesCheckbox'),
            container: id('tagsContainer'),
            nav: id('categoriesNav'),
            navList: id('categoriesNavList'),
            pinBtn: id('pinHeaderButton'),
            header: document.querySelector('.header-panel'),
            main: id('mainContainer'),
            scrollHints: [id('leftScrollHint'), id('rightScrollHint')]
        };
    }

    // Хелпер создания элементов
    el(tag, cls = '', text = '', attrs = {}) {
        const d = document.createElement(tag);
        if (cls) d.className = cls;
        if (text) d.textContent = text;
        Object.entries(attrs).forEach(([k, v]) => d.setAttribute(k, v));
        return d;
    }

    async loadData() {
        const getConf = () => {
            const p = new URLSearchParams(window.location.search).get('conf');
            return p && !p.endsWith('.json') ? `${p}.json` : (p || 'tags.json');
        };
        const file = getConf();
        const fetchFile = async (f) => {
            const r = await fetch(f);
            if (!r.ok) throw new Error(r.status);
            return await r.json();
        };

        try {
            this.tagsData = await fetchFile(file);
            return true;
        } catch (e) {
            console.warn(`Error loading ${file}, trying fallback...`);
            if (file !== 'tags.json') {
                try {
                    this.tagsData = await fetchFile('tags.json');
                    return true;
                } catch (e2) { }
            }
            this.error(`Не удалось загрузить ${file}`);
            return false;
        }
    }

    initCategories() {
        this.categories.clear();
        this.allTagsInOrder = [];
        this.tagIndexMap.clear();

        this.tagsData.categories.forEach(cat => {
            const catData = {
                ...cat,
                requirement: cat.requirement || 'none',
                tags: new Map(),
                selectedTags: new Set(),
                orderedTags: [],
                variantGroups: new Map(),
                selectedVariants: new Map(),
                dom: null
            };

            cat.tags.forEach(t => {
                const names = Array.isArray(t.name) ? t.name : [t.name];
                const main = names[0];
                if (names.length > 1) catData.variantGroups.set(main, names);

                names.forEach(name => {
                    catData.tags.set(name, {
                        name, mainName: main,
                        alternative: t.alternative || '',
                        subgroup: t.subgroup || '',
                        description: t.description || '',
                        isVariant: name !== main,
                        isMainTag: t.main || false
                    });

                    // Заполняем глобальный список и карту поиска
                    const tagInfo = { name, mainName: main, category: cat.name, catData, tagConfig: t };
                    this.allTagsInOrder.push(tagInfo);
                    if (!this.tagIndexMap.has(name)) this.tagIndexMap.set(name, []);
                    this.tagIndexMap.get(name).push(this.allTagsInOrder.length - 1);
                });
            });
            this.categories.set(cat.name, catData);
        });
    }

    setupEvents() {
        const { input, limitBox, dupBox, pinBtn, main, header, container } = this.dom;

        input.addEventListener('input', () => { this.parseInput(input.value); this.updateUI(); });
        limitBox.addEventListener('change', () => this.updateUI());
        dupBox.addEventListener('change', () => this.updateAlt());

        // Делегирование событий тегов
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.tag-button');
            if (!btn) return;
            const catName = btn.closest('.category').querySelector('.category-title').textContent;
            this.handleTagClick(catName, btn.textContent);
        });

        const togglePin = () => {
            this.isHeaderPinned = !this.isHeaderPinned;
            this.updatePinState();
            localStorage.setItem('headerPinned', this.isHeaderPinned);
        };
        pinBtn.addEventListener('click', togglePin);

        // Saved state
        const saved = localStorage.getItem('headerPinned');
        this.isHeaderPinned = saved !== null ? JSON.parse(saved) : true;

        // Global events
        const updateLayout = () => {
            this.updateNavVis();
            this.updateScrollHints();
            if (this.isHeaderPinned) this.updateHeaderOffset();
        };

        window.addEventListener('resize', updateLayout);
        window.addEventListener('scroll', updateLayout);
        window.addEventListener('load', () => setTimeout(updateLayout, 100));

        // Click outside to scroll top
        document.body.addEventListener('click', (e) => {
            if (!main.contains(e.target) && !header.contains(e.target)) window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        this.dom.scrollHints.forEach(h => h.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' })));
    }

    render() {
        const { container, navList } = this.dom;
        container.innerHTML = '';
        navList.innerHTML = '';

        this.categories.forEach((catData, catName) => {
            // Render Category in Main List
            const catDiv = this.el('div', 'category');
            catData.dom = catDiv;

            const titleRow = this.el('div', 'category-title-container');
            const left = this.el('div', 'category-title-left');
            left.append(this.el('div', 'category-title', catName));
            if (catData.description) left.append(this.el('button', 'category-help-button', '?', { 'data-tooltip': catData.description }));

            const scrollTop = this.el('button', 'category-scroll-top', '↑', { 'aria-label': 'Наверх' });
            scrollTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

            titleRow.append(left, scrollTop);
            catDiv.append(titleRow, this.el('div', 'category-warning util-hidden'));

            // Render Subgroups
            const subgroups = this.groupTags(catData);
            subgroups.forEach((tags, subName) => {
                const subDiv = this.el('div', 'subgroup');
                if (subName && !subName.startsWith('!')) {
                    subDiv.append(this.el('div', 'subgroup-title', subName));
                } else if (subName.startsWith('!')) { // Просто контейнер без заголовка
                    // Logic preserved implicitly by appending to subDiv
                }

                const groupDiv = this.el('div', 'tags-group');
                tags.forEach(item => {
                    if (item.type === 'variant') {
                        const vGroup = this.el('div', 'variant-group');
                        const vBtns = this.el('div', 'variant-buttons');
                        item.variants.forEach(t => vBtns.append(this.createBtn(t)));
                        vGroup.append(vBtns);
                        if (item.desc) vGroup.append(this.el('div', 'variant-description', item.desc));
                        groupDiv.append(vGroup);
                    } else {
                        groupDiv.append(this.createBtn(item.tag));
                    }
                });
                subDiv.append(groupDiv);
                catDiv.append(subDiv);
            });
            container.append(catDiv);

            // Render Nav Item
            const navItem = this.el('button', 'category-nav-item', catName);
            navItem.onclick = () => this.scrollToCat(catName);
            navList.append(navItem);
        });

        this.updateNavVis();
        this.updatePinState();
    }

    createBtn(tag) {
        return this.el('button', `tag-button util-tag-base${tag.isMainTag ? ' main-tag' : ''}`, tag.name, {
            'data-tooltip': tag.description || ''
        });
    }

    groupTags(catData) {
        const subs = new Map();
        const processed = new Set();

        catData.variantGroups.forEach((vars, main) => {
            const tag = catData.tags.get(vars[0]);
            if (!tag) return;
            const s = tag.subgroup || '';
            if (!subs.has(s)) subs.set(s, []);
            subs.get(s).push({
                type: 'variant', variants: vars.map(v => catData.tags.get(v)), desc: tag.description
            });
            processed.add(main);
        });

        catData.tags.forEach(tag => {
            if (tag.isVariant || processed.has(tag.mainName)) return;
            const s = tag.subgroup || '';
            if (!subs.has(s)) subs.set(s, []);
            subs.get(s).push({ type: 'single', tag });
        });
        return subs;
    }

    handleTagClick(catName, tagName) {
        const cat = this.categories.get(catName);
        const tag = cat.tags.get(tagName);
        const main = tag.mainName;
        const setSel = (c, m, v) => {
            c.selectedTags.add(m);
            this.selectedTags.set(m, c.name);
            c.selectedVariants.set(m, v);
        };
        const delSel = (c, m) => {
            c.selectedTags.delete(m);
            this.selectedTags.delete(m);
            c.selectedVariants.delete(m);
        };

        if (cat.type === 'single') {
            const isActive = cat.selectedTags.has(main);
            cat.selectedTags.forEach(m => delSel(cat, m)); // Clear all
            if (!isActive) setSel(cat, main, tagName); // Toggle on
        } else if (cat.type === 'ordered') {
            if (cat.selectedTags.has(main)) {
                cat.orderedTags = cat.orderedTags.filter(t => t !== main);
                delSel(cat, main);
            } else {
                cat.orderedTags.push(main);
                setSel(cat, main, tagName);
            }
            // Sort: main tags first
            cat.orderedTags.sort((a, b) => {
                const isAm = cat.tags.get(a).isMainTag, isBm = cat.tags.get(b).isMainTag;
                return (isAm === isBm) ? 0 : isAm ? -1 : 1;
            });
        } else { // Standard
            const curVar = cat.selectedVariants.get(main);
            if (cat.selectedTags.has(main) && curVar === tagName) delSel(cat, main);
            else setSel(cat, main, tagName);
        }
        this.updateUI();
    }

    parseInput(str) {
        this.selectedTags.clear();
        this.categories.forEach(c => {
            c.selectedTags.clear(); c.orderedTags = []; c.selectedVariants.clear();
        });

        const rawTags = str.split(this.tagsData.separator).map(t => t.trim()).filter(Boolean);
        if (!rawTags.length) return;

        let lastIdx = -1;

        rawTags.forEach(tName => {
            const indices = this.tagIndexMap.get(tName);
            if (!indices) return;

            // Find next occurrence after lastIdx
            let found = indices.find(i => i > lastIdx);
            // If not found, wrapping search from start
            if (found === undefined) found = indices[0];

            if (found !== undefined) {
                const info = this.allTagsInOrder[found];
                const cat = info.catData;
                const main = info.mainName;

                if (cat.type === 'single') {
                    cat.selectedTags.clear();
                    cat.selectedTags.add(main);
                    cat.selectedVariants.set(main, info.name);
                } else {
                    if (!cat.selectedTags.has(main)) {
                        cat.selectedTags.add(main);
                        if (cat.type === 'ordered') cat.orderedTags.push(main);
                    }
                    cat.selectedVariants.set(main, info.name);
                }
                this.selectedTags.set(main, info.category);
                lastIdx = found;
            }
        });
    }

    updateUI() {
        // Build result string
        const res = [];
        this.tagsData.categories.forEach(cfg => {
            const cat = this.categories.get(cfg.name);
            const process = (main) => res.push(cat.selectedVariants.get(main) || main);

            if (cat.type === 'ordered') cat.orderedTags.forEach(process);
            else if (cat.type === 'single') { if (cat.selectedTags.size) process([...cat.selectedTags][0]); }
            else {
                // Preserve config order
                cfg.tags.forEach(t => {
                    const main = Array.isArray(t.name) ? t.name[0] : t.name;
                    if (cat.selectedTags.has(main)) process(main);
                });
            }
        });

        const resStr = res.join(this.tagsData.separator);
        const limit = this.tagsData.characterLimit;
        const isLim = this.dom.limitBox.checked;

        if (isLim && resStr.length > limit) {
            // Re-parse current input to reset state to valid previous state effectively
            // (Simplification of original logic which re-parsed input value)
            this.parseInput(this.dom.input.value);
        } else {
            this.dom.input.value = resStr;
        }

        this.dom.limitDisp.textContent = `${resStr.length}/${limit}`;
        this.dom.limitDisp.classList.toggle('exceeded', isLim && resStr.length > limit);

        // Update visuals
        this.categories.forEach(cat => {
            if (!cat.dom) return;
            const btns = cat.dom.querySelectorAll('.tag-button');
            btns.forEach(btn => {
                const tName = btn.textContent;
                const tag = cat.tags.get(tName);
                if (!tag) return;
                const sel = cat.selectedTags.has(tag.mainName) && cat.selectedVariants.get(tag.mainName) === tName;
                btn.classList.toggle('selected', sel);

                if (cat.type === 'ordered' && sel) {
                    btn.classList.add('ordered');
                    btn.setAttribute('data-order', cat.orderedTags.indexOf(tag.mainName) + 1);
                } else {
                    btn.classList.remove('ordered');
                    btn.removeAttribute('data-order');
                }
            });

            // Warnings
            const warn = cat.dom.querySelector('.category-warning');
            let showWarn = false;
            let txt = '';
            if (cat.requirement === 'atLeastOne') {
                showWarn = cat.selectedTags.size === 0;
                txt = 'Необходимо выбрать хотя бы один тег';
            } else if (cat.requirement === 'atLeastOneMain') {
                showWarn = ![...cat.selectedTags].some(m => cat.tags.get(m).isMainTag);
                txt = 'Необходимо выбрать хотя бы один главный тег';
            }
            warn.textContent = txt;
            warn.classList.toggle('util-hidden', !showWarn);
        });

        this.updateAlt();
    }

    updateAlt() {
        const alts = [];
        const seen = new Set();
        const add = (t) => {
            if (t && t.alternative) {
                const norm = t.alternative.trim().toLowerCase().replace(/\s+/g, ' ');
                if (!this.dom.dupBox.checked || !seen.has(norm)) {
                    alts.push(t.alternative);
                    seen.add(norm);
                }
            }
        };

        this.tagsData.categories.forEach(cfg => {
            const cat = this.categories.get(cfg.name);
            const iter = (m) => add(cat.tags.get(m));
            if (cat.type === 'ordered') cat.orderedTags.forEach(iter);
            else if (cat.type === 'single') { if (cat.selectedTags.size) iter([...cat.selectedTags][0]); }
            else {
                cfg.tags.forEach(t => {
                    const m = Array.isArray(t.name) ? t.name[0] : t.name;
                    if (cat.selectedTags.has(m) && t.alternative) add(t);
                });
            }
        });

        const s = alts.join(this.tagsData.alternativeSeparator);
        this.dom.altSection.classList.toggle('util-hidden', !s);
        this.dom.altOut.value = s;
        if (this.isHeaderPinned) setTimeout(() => this.updateHeaderOffset(), 50);
    }

    scrollToCat(name) {
        const el = this.categories.get(name)?.dom;
        if (!el) return;
        const offset = this.isHeaderPinned ? (this.dom.header.offsetHeight + 30) : 20;
        const top = el.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: 'smooth' });
    }

    updateHeaderOffset() {
        if (!this.isHeaderPinned) { this.dom.main.style.paddingTop = ''; return; }
        const h = this.dom.header.offsetHeight;
        this.dom.main.style.paddingTop = `${h + 45}px`;
    }

    updatePinState() {
        const { pinBtn, header, main } = this.dom;
        const act = this.isHeaderPinned;
        pinBtn.classList.toggle('active', act);
        header.classList.toggle('pinned', act);
        main.classList.toggle('has-pinned-header', act);
        pinBtn.textContent = act ? 'Закреплено' : 'Закрепить';
        this.updateNavVis();
        this.updateScrollHints();
        this.updateHeaderOffset();
    }

    updateNavVis() {
        const need = this.dom.main.scrollHeight > window.innerHeight || this.isHeaderPinned;
        this.dom.nav.classList.toggle('util-hidden', !need);
    }

    updateScrollHints() {
        const vis = window.innerWidth > this.dom.main.offsetWidth + 200 && window.scrollY > 100;
        this.dom.scrollHints.forEach(h => h.classList.toggle('visible', vis));
    }

    updateState() { this.updateUI(); }
    showUI() { this.dom.loading.classList.add('util-hidden'); this.dom.error.classList.add('util-hidden'); this.dom.app.classList.remove('util-hidden'); }
    error(t) { this.dom.loading.classList.add('util-hidden'); this.dom.errDetail.textContent = t; this.dom.error.classList.remove('util-hidden'); this.dom.app.classList.add('util-hidden'); }
}

document.addEventListener('DOMContentLoaded', () => new TagsManager());