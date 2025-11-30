class TagsManager {
    constructor() {
        this.tagsData = null;
        this.selectedTags = new Map();
        this.categories = new Map();
        this.allTagsInOrder = [];
        this.tagIndexMap = new Map();
        this.knownAsMap = new Map();
        this.altTagSearchMap = new Map();
        this.unrecognizedTags = [];
        this.isHeaderPinned = true;
        this.dom = {};

        this.themeState = 'auto';
        this.themeIcons = { auto: '🌓', dark: '🌙', light: '☀️' };
        this.themeTexts = { auto: 'Авто', dark: 'Тёмная', light: 'Светлая' };

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
                this.updateUI();
            }
        } catch (e) {
            console.error(e);
            if (!this.dom.error.classList.contains('util-hidden')) return;
            this.error(`Критическая ошибка инициализации: ${e.message}`, 'Критическая ошибка');
        }
    }

    cacheDOM() {
        const id = x => document.getElementById(x);
        this.dom = {
            loading: id('loadingMessage'),
            error: id('errorMessage'),
            errDetail: id('errorDetails'),
            errTitle: id('errorTitle'),
            app: id('appContainer'),
            input: id('tagsInput'),
            unrecWarn: id('unrecognizedTagsWarning'),
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
            scrollHints: [id('leftScrollHint'), id('rightScrollHint')],
            refSection: id('referenceSection'),
            refToggleBtn: id('toggleReferenceButton'),
            refContent: id('referenceContent'),
            themeToggleBtn: id('themeToggleButton'),
            themeIcon: document.querySelector('.theme-icon'),
            themeText: document.querySelector('.theme-text')
        };
    }

    el(tag, cls = '', text = '', attrs = {}) {
        const d = document.createElement(tag);
        if (cls) d.className = cls;
        if (text) d.textContent = text;
        Object.entries(attrs).forEach(([k, v]) => d.setAttribute(k, v));
        return d;
    }

    async loadData() {
        const getParams = () => {
            const p = new URLSearchParams(window.location.search).get('conf');
            return p && !p.endsWith('.json') ? `${p}.json` : (p || 'tags.json');
        };

        const fetchFile = async (f) => {
            const r = await fetch(f);
            if (!r.ok) throw new Error(`Файл не найден (статус: ${r.status})`);
            return await r.json();
        };

        const fileName = getParams();
        try {
            this.tagsData = await fetchFile(fileName);
            return true;
        } catch (e) {
            console.warn(`Error loading ${fileName}: ${e.message}`);
            // Попытка загрузить дефолтный файл, если запрошенный не найден
            if (fileName !== 'tags.json') {
                try {
                    this.tagsData = await fetchFile('tags.json');
                    return true;
                } catch (fallbackErr) {
                    console.error(`Fallback failed: ${fallbackErr.message}`);
                }
            }

            const isJsonError = e.message.includes('JSON');
            const errorTitle = isJsonError ? 'Ошибка в формате JSON' : 'Файл конфигурации не найден';
            const errorText = isJsonError
                ? `Файл **${fileName}** содержит ошибку формата: ${e.message}`
                : `Файл **${fileName}** не найден или недоступен.`;

            this.error(errorText, errorTitle);
            return false;
        }
    }

    initCategories() {
        this.categories.clear();
        this.allTagsInOrder = [];
        this.tagIndexMap.clear();
        this.knownAsMap.clear();
        this.altTagSearchMap.clear();

        this.tagsData.categories.forEach(cat => {
            const catData = {
                ...cat,
                requirement: cat.requirement || 'none',
                overrideRequirementText: cat.overrideRequirementText || '',
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
                        isMainTag: t.main || false,
                        knownAs: t.knownAs || []
                    });

                    // Глобальная индексация
                    const tagInfo = { name, mainName: main, category: cat.name, catData, tagConfig: t };
                    this.allTagsInOrder.push(tagInfo);
                    const currentIndex = this.allTagsInOrder.length - 1;
                    const lowerName = name.toLowerCase();

                    // 1. Индекс по имени
                    if (!this.tagIndexMap.has(lowerName)) this.tagIndexMap.set(lowerName, []);
                    this.tagIndexMap.get(lowerName).push(currentIndex);

                    // 2. Индекс по алиасам (knownAs)
                    if (t.knownAs && Array.isArray(t.knownAs)) {
                        t.knownAs.forEach(alias => {
                            const cleanAlias = alias.trim().toLowerCase();
                            if (!this.knownAsMap.has(cleanAlias)) this.knownAsMap.set(cleanAlias, []);
                            this.knownAsMap.get(cleanAlias).push(currentIndex);
                        });
                    }

                    // 3. Индекс альтернативных комбинаций имен
                    if (names.length === 1 && name.includes('/')) {
                        this.generateAltNames(name).forEach(altName => {
                            const lowerAlt = altName.toLowerCase();
                            if (!this.altTagSearchMap.has(lowerAlt)) this.altTagSearchMap.set(lowerAlt, []);
                            this.altTagSearchMap.get(lowerAlt).push(currentIndex);
                        });
                    }
                });
            });
            this.categories.set(cat.name, catData);
        });
    }

    generateAltNames(name) {
        const parts = name.split(/\s+/).map(p => p.split('/').filter(Boolean));
        const combine = (arr, index = 0, current = []) => {
            if (index === arr.length) return [current.join(' ').trim()];
            let results = [];
            for (const item of arr[index]) {
                results.push(...combine(arr, index + 1, [...current, item]));
            }
            return results;
        };
        return combine(parts).filter(Boolean);
    }

    setupEvents() {
        const { input, limitBox, dupBox, pinBtn, main, header, container, themeToggleBtn, unrecWarn } = this.dom;

        input.addEventListener('input', () => {
            unrecWarn.classList.add('util-hidden');
            this.parseInput(input.value);
            this.updateUI();
        });

        limitBox.addEventListener('change', () => this.updateUI());
        dupBox.addEventListener('change', () => this.updateAlt());

        const { refToggleBtn, refContent } = this.dom;
        refToggleBtn.addEventListener('click', () => {
            const isHidden = refContent.classList.toggle('util-hidden');
            refToggleBtn.textContent = isHidden ? 'Важная информация' : 'Скрыть';
            if (this.isHeaderPinned) this.updateHeaderOffset();
        });

        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.tag-button');
            if (!btn) return;
            const catName = btn.closest('.category').querySelector('.category-title').textContent;
            this.handleTagClick(catName, btn.textContent);
        });

        pinBtn.addEventListener('click', () => {
            this.isHeaderPinned = !this.isHeaderPinned;
            this.updatePinState();
            localStorage.setItem('headerPinned', this.isHeaderPinned);
        });

        const savedPinned = localStorage.getItem('headerPinned');
        this.isHeaderPinned = savedPinned !== null ? JSON.parse(savedPinned) : true;

        themeToggleBtn.addEventListener('click', () => this.toggleTheme());
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            this.themeState = savedTheme;
            this.applyTheme();
        }

        const updateLayout = () => {
            this.updateNavVis();
            this.updateScrollHints();
            if (this.isHeaderPinned) this.updateHeaderOffset();
        };

        window.addEventListener('resize', updateLayout);
        window.addEventListener('scroll', updateLayout);
        window.addEventListener('load', () => setTimeout(updateLayout, 100));

        document.body.addEventListener('click', (e) => {
            if (!main.contains(e.target) && !header.contains(e.target)) window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        this.dom.scrollHints.forEach(h => h.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' })));
    }

    render() {
        const { container, navList, refSection, refContent, refToggleBtn } = this.dom;
        container.innerHTML = '';
        navList.innerHTML = '';

        const referenceHtml = this.tagsData.reference || '';
        if (referenceHtml) {
            refContent.innerHTML = referenceHtml;
            refSection.classList.remove('util-hidden');
            refContent.classList.add('util-hidden');
            refToggleBtn.textContent = 'Важная информация';
        } else {
            refSection.classList.add('util-hidden');
        }

        this.categories.forEach((catData, catName) => {
            const catDiv = this.el('div', 'category');
            catData.dom = catDiv;

            const titleRow = this.el('div', 'category-title-container');
            const left = this.el('div', 'category-title-left');
            left.append(this.el('div', 'category-title', catName));
            if (catData.description) {
                left.append(this.el('button', 'category-help-button', '?', { 'data-tooltip': catData.description }));
            }

            const scrollTop = this.el('button', 'category-scroll-top', '˄', { 'aria-label': 'Наверх' });
            scrollTop.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

            titleRow.append(left, scrollTop);
            catDiv.append(titleRow, this.el('div', 'category-warning util-hidden'));

            const subgroups = this.groupTags(catData);
            subgroups.forEach((tags, subName) => {
                const subDiv = this.el('div', 'subgroup');
                if (subName && !subName.startsWith('!')) {
                    subDiv.append(this.el('div', 'subgroup-title', subName));
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

    toggleTheme() {
        const states = ['auto', 'dark', 'light'];
        this.themeState = states[(states.indexOf(this.themeState) + 1) % states.length];
        this.applyTheme();
        localStorage.setItem('theme', this.themeState);
    }

    applyTheme() {
        const html = document.documentElement;
        this.themeState === 'auto' ? html.removeAttribute('data-theme') : html.setAttribute('data-theme', this.themeState);
        if (this.dom.themeIcon) this.dom.themeIcon.textContent = this.themeIcons[this.themeState];
        if (this.dom.themeText) this.dom.themeText.textContent = this.themeTexts[this.themeState];
        this.dom.themeToggleBtn.title = `Тема: ${this.themeTexts[this.themeState]}`;
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

        const setSel = (v) => {
            cat.selectedTags.add(main);
            this.selectedTags.set(main, cat.name);
            cat.selectedVariants.set(main, v);
        };
        const delSel = () => {
            cat.selectedTags.delete(main);
            this.selectedTags.delete(main);
            cat.selectedVariants.delete(main);
        };

        if (cat.type === 'single') {
            const isActive = cat.selectedTags.has(main);
            cat.selectedTags.forEach(m => {
                cat.selectedTags.delete(m);
                this.selectedTags.delete(m);
                cat.selectedVariants.delete(m);
            });
            if (!isActive) setSel(tagName);
        } else if (cat.type === 'ordered') {
            if (cat.selectedTags.has(main)) {
                cat.orderedTags = cat.orderedTags.filter(t => t !== main);
                delSel();
            } else {
                cat.orderedTags.push(main);
                setSel(tagName);
            }
            // Сортировка: Main tags имеют приоритет
            cat.orderedTags.sort((a, b) => {
                const isAm = cat.tags.get(a).isMainTag, isBm = cat.tags.get(b).isMainTag;
                return (isAm === isBm) ? 0 : isAm ? -1 : 1;
            });
        } else {
            const curVar = cat.selectedVariants.get(main);
            if (cat.selectedTags.has(main) && curVar === tagName) delSel();
            else setSel(tagName);
        }
        this.updateUI();
    }

    parseInput(str) {
        this.selectedTags.clear();
        this.categories.forEach(c => {
            c.selectedTags.clear(); c.orderedTags = []; c.selectedVariants.clear();
        });
        this.unrecognizedTags = [];

        const rawTags = str.split(this.tagsData.separator).map(t => t.trim()).filter(Boolean);
        if (!rawTags.length) return;

        const recognizedIndices = new Set();
        let lastIdx = -1;

        // Хелпер для кольцевого поиска индекса
        const findRingIndex = (indices) => {
            if (!indices) return -1;
            const sorted = [...indices].sort((a, b) => a - b);
            const after = sorted.find(i => i > lastIdx);
            return after !== undefined ? after : sorted.find(i => i <= lastIdx);
        };

        // Хелпер для поиска в картах
        const findTagInMaps = (term) => {
            const maps = [this.tagIndexMap, this.knownAsMap, this.altTagSearchMap];
            for (const map of maps) {
                if (map.has(term)) {
                    const idx = findRingIndex(map.get(term));
                    if (idx !== -1 && idx !== undefined) return idx;
                }
            }
            return -1;
        };

        rawTags.forEach((tNameOriginal, tagIndex) => {
            const tName = tNameOriginal.toLowerCase();
            const foundIndex = findTagInMaps(tName);

            if (foundIndex !== -1) {
                const info = this.allTagsInOrder[foundIndex];
                const cat = info.catData;
                const main = info.mainName;

                if (cat.type === 'single') {
                    cat.selectedTags.clear();
                    cat.selectedTags.add(main);
                } else {
                    if (!cat.selectedTags.has(main)) cat.selectedTags.add(main);
                    if (cat.type === 'ordered' && !cat.orderedTags.includes(main)) cat.orderedTags.push(main);
                }

                cat.selectedVariants.set(main, info.name);
                this.selectedTags.set(main, info.category);
                lastIdx = foundIndex;
                recognizedIndices.add(tagIndex);
            }
        });

        this.unrecognizedTags = rawTags.filter((_, index) => !recognizedIndices.has(index));
    }

    // Хелпер для итерации по выбранным тегам с учетом типа категории
    processSelectedTags(callback) {
        this.tagsData.categories.forEach(cfg => {
            const cat = this.categories.get(cfg.name);
            const run = (main) => {
                const variantName = cat.selectedVariants.get(main) || main;
                const tagObj = cat.tags.get(variantName);
                if (tagObj) callback(variantName, tagObj);
            };

            if (cat.type === 'ordered') {
                cat.orderedTags.forEach(run);
            } else if (cat.type === 'single') {
                if (cat.selectedTags.size) run([...cat.selectedTags][0]);
            } else {
                cfg.tags.forEach(t => {
                    const main = Array.isArray(t.name) ? t.name[0] : t.name;
                    if (cat.selectedTags.has(main)) run(main);
                });
            }
        });
    }

    updateUI() {
        const res = [];
        this.processSelectedTags((name) => res.push(name));

        const resStr = res.join(this.tagsData.separator);
        const limit = this.tagsData.characterLimit;
        const isLim = this.dom.limitBox.checked;

        if (isLim && resStr.length > limit) {
            // Если превышен лимит, перепарсиваем текущий инпут (фактически отмена последнего действия)
            this.parseInput(this.dom.input.value);
        } else {
            this.dom.input.value = resStr;
        }

        this.dom.limitDisp.textContent = `${resStr.length}/${limit}`;
        this.dom.limitDisp.classList.toggle('exceeded', isLim && resStr.length > limit);

        const { unrecWarn } = this.dom;
        if (this.unrecognizedTags.length > 0) {
            unrecWarn.textContent = `Не распознано: ${this.unrecognizedTags.join(', ')}`;
            unrecWarn.classList.remove('util-hidden');
        } else {
            unrecWarn.classList.add('util-hidden');
        }

        this.updateButtonsState();
        this.updateAlt();
    }

    updateButtonsState() {
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

            const warn = cat.dom.querySelector('.category-warning');
            let showWarn = false;
            let txt = '';

            if (cat.requirement === 'atLeastOne') {
                showWarn = cat.selectedTags.size === 0;
                txt = cat.overrideRequirementText || 'Необходимо выбрать хотя бы один тег';
            } else if (cat.requirement === 'atLeastOneMain') {
                showWarn = ![...cat.selectedTags].some(m => cat.tags.get(m).isMainTag);
                txt = cat.overrideRequirementText || 'Необходимо выбрать хотя бы один главный тег';
            }
            warn.textContent = txt;
            warn.classList.toggle('util-hidden', !showWarn);
        });
    }

    updateAlt() {
        const alts = [];
        const seen = new Set();

        this.processSelectedTags((_, tagObj) => {
            if (tagObj.alternative) {
                const norm = tagObj.alternative.trim().toLowerCase().replace(/\s+/g, ' ');
                if (!this.dom.dupBox.checked || !seen.has(norm)) {
                    alts.push(tagObj.alternative);
                    seen.add(norm);
                }
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
        pinBtn.textContent = act ? 'Закреплено' : 'Закрепить окно';
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

    showUI() {
        this.dom.loading.classList.add('util-hidden');
        this.dom.error.classList.add('util-hidden');
        this.dom.app.classList.remove('util-hidden');
    }

    error(detailText, title = 'Ошибка загрузки конфигурации') {
        this.dom.loading.classList.add('util-hidden');
        this.dom.errTitle.textContent = title;
        this.dom.errDetail.innerHTML = detailText.replace(/\*\*(.*?)\*\*/g, '<code>$1</code>');
        this.dom.error.classList.remove('util-hidden');
        this.dom.app.classList.add('util-hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => new TagsManager());