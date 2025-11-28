class TagsManager {
    constructor() {
        this.tagsData = null;
        this.selectedTags = new Map();
        this.categories = new Map();
        this.allTagsInOrder = [];
        this.tagIndexMap = new Map();
        this.knownAsMap = new Map(); // Новая карта для поиска по alias
        this.altTagSearchMap = new Map();
        this.unrecognizedTags = []; // ДОБАВЛЕНО: для хранения нераспознанных тегов
        this.isHeaderPinned = true;
        this.dom = {};

        this.themeState = 'auto';
        this.themeIcons = {
            auto: '🌓',
            dark: '🌙',
            light: '☀️'
        };
        this.themeTexts = {
            auto: 'Авто',
            dark: 'Тёмная',
            light: 'Светлая'
        };

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
            unrecWarn: id('unrecognizedTagsWarning'), // ДОБАВЛЕНО
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
        const getConf = () => {
            const p = new URLSearchParams(window.location.search).get('conf');
            return p && !p.endsWith('.json') ? `${p}.json` : (p || 'tags.json');
        };
        const file = getConf();

        const fetchFile = async (f) => {
            const r = await fetch(f);
            if (!r.ok) throw new Error(`Файл не найден или недоступен (статус: ${r.status})`);
            try {
                return await r.json();
            } catch (jsonE) {
                throw new Error(`Ошибка разбора JSON: ${jsonE.message}`);
            }
        };

        try {
            this.tagsData = await fetchFile(file);
            return true;
        } catch (e) {
            console.warn(`Error loading ${file}: ${e.message}`);
            let errorText = e.message;
            let errorTitle = `Ошибка загрузки ${file}`;

            if (e.message.includes('не найден')) {
                errorText = `Файл конфигурации **${file}** не найден или недоступен. Проверьте путь и имя файла.`;
                errorTitle = 'Файл конфигурации не найден';
            } else if (e.message.includes('разбора JSON')) {
                errorText = `Файл конфигурации **${file}** содержит ошибку в формате JSON: ${e.message.split(':').slice(1).join(':').trim()}`;
                errorTitle = 'Ошибка в формате JSON';
            } else if (file !== 'tags.json') {
                try {
                    this.tagsData = await fetchFile('tags.json');
                    return true;
                } catch (e2) {
                    console.error(`Fallback failed: ${e2.message}`);
                    errorText += `\n\nНе удалось также загрузить файл по умолчанию \`tags.json\`.`;
                    errorTitle = 'Ошибка загрузки конфигурации';
                }
            }

            if (!this.tagsData) {
                this.error(errorText, errorTitle);
                return false;
            }
            return true;
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

                    // Заполняем глобальный список и карты поиска
                    const tagInfo = { name, mainName: main, category: cat.name, catData, tagConfig: t };
                    this.allTagsInOrder.push(tagInfo);
                    const currentIndex = this.allTagsInOrder.length - 1;

                    // 1. Индексация по имени: Ключ в нижнем регистре
                    const lowerName = name.toLowerCase();
                    if (!this.tagIndexMap.has(lowerName)) this.tagIndexMap.set(lowerName, []);
                    this.tagIndexMap.get(lowerName).push(currentIndex);

                    // 2. Индексация по knownAs: Ключи в нижнем регистре
                    if (t.knownAs && Array.isArray(t.knownAs)) {
                        t.knownAs.forEach(alias => {
                            const cleanAlias = alias.trim().toLowerCase(); // Приводим к нижнему регистру
                            if (!this.knownAsMap.has(cleanAlias)) this.knownAsMap.set(cleanAlias, []);
                            this.knownAsMap.get(cleanAlias).push(currentIndex);
                        });
                    }

                    // 3. Индексация альтернативных имен
                    if (names.length === 1 && name.includes('/')) {
                        const generatedNames = this.generateAltNames(name);
                        generatedNames.forEach(altName => {
                            const lowerAltName = altName.toLowerCase(); // Приводим к нижнему регистру
                            if (!this.altTagSearchMap.has(lowerAltName)) this.altTagSearchMap.set(lowerAltName, []);
                            this.altTagSearchMap.get(lowerAltName).push(currentIndex);
                        });
                    }
                });
            });
            this.categories.set(cat.name, catData);
        });
    }

    generateAltNames(name) {
        const parts = name.split(/\s+/);
        const slashParts = parts.map(p => p.split('/').filter(Boolean));

        const combine = (arr, index = 0, current = []) => {
            if (index === arr.length) return [current.join(' ').trim()];
            let results = [];
            for (const item of arr[index]) {
                results.push(...combine(arr, index + 1, [...current, item]));
            }
            return results;
        };

        return combine(slashParts).filter(Boolean);
    }

    setupEvents() {
        const { input, limitBox, dupBox, pinBtn, main, header, container, themeToggleBtn, unrecWarn } = this.dom; // ДОБАВЛЕНО unrecWarn

        // ИЗМЕНЕНО: Скрываем предупреждение при ручном вводе
        input.addEventListener('input', () => {
            unrecWarn.classList.add('util-hidden'); // Скрываем предупреждение, как только пользователь начинает ввод
            this.parseInput(input.value);
            this.updateUI();
        });

        limitBox.addEventListener('change', () => this.updateUI());
        dupBox.addEventListener('change', () => this.updateAlt());

        const { refToggleBtn, refContent } = this.dom;
        const toggleReference = () => {
            const isHidden = refContent.classList.toggle('util-hidden');
            refToggleBtn.textContent = isHidden ? 'Важная информация' : 'Скрыть';
            if (this.isHeaderPinned) this.updateHeaderOffset();
        };
        refToggleBtn.addEventListener('click', toggleReference);

        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.tag-button');
            if (!btn) return;
            const catName = btn.closest('.category').querySelector('.category-title').textContent;
            this.handleTagClick(catName, btn.textContent);
            // ПРИМЕЧАНИЕ: При нажатии на кнопку предупреждение не скрывается явно. 
            // Его видимость обновится в updateUI на основе результата парсинга.
        });

        const togglePin = () => {
            this.isHeaderPinned = !this.isHeaderPinned;
            this.updatePinState();
            localStorage.setItem('headerPinned', this.isHeaderPinned);
        };
        pinBtn.addEventListener('click', togglePin);

        const saved = localStorage.getItem('headerPinned');
        this.isHeaderPinned = saved !== null ? JSON.parse(saved) : true;

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
        const { container, navList } = this.dom;
        container.innerHTML = '';
        navList.innerHTML = '';

        const { refSection, refContent, refToggleBtn } = this.dom;
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
            if (catData.description) left.append(this.el('button', 'category-help-button', '?', { 'data-tooltip': catData.description }));

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
        const currentIndex = states.indexOf(this.themeState);
        this.themeState = states[(currentIndex + 1) % states.length];

        this.applyTheme();
        this.saveTheme();
    }

    applyTheme() {
        const html = document.documentElement;
        if (this.themeState === 'auto') {
            html.removeAttribute('data-theme');
        } else {
            html.setAttribute('data-theme', this.themeState);
        }

        if (this.dom.themeIcon) this.dom.themeIcon.textContent = this.themeIcons[this.themeState];
        if (this.dom.themeText) this.dom.themeText.textContent = this.themeTexts[this.themeState];
        this.dom.themeToggleBtn.title = `Тема: ${this.themeTexts[this.themeState]}`;
    }

    saveTheme() {
        localStorage.setItem('theme', this.themeState);
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
            cat.selectedTags.forEach(m => delSel(cat, m));
            if (!isActive) setSel(cat, main, tagName);
        } else if (cat.type === 'ordered') {
            if (cat.selectedTags.has(main)) {
                cat.orderedTags = cat.orderedTags.filter(t => t !== main);
                delSel(cat, main);
            } else {
                cat.orderedTags.push(main);
                setSel(cat, main, tagName);
            }
            cat.orderedTags.sort((a, b) => {
                const isAm = cat.tags.get(a).isMainTag, isBm = cat.tags.get(b).isMainTag;
                return (isAm === isBm) ? 0 : isAm ? -1 : 1;
            });
        } else {
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

        this.unrecognizedTags = []; // ДОБАВЛЕНО: Сброс списка нераспознанных тегов

        // Разделяем, обрезаем пробелы, но сохраняем регистр
        const rawTags = str.split(this.tagsData.separator)
            .map(t => t.trim())
            .filter(Boolean);

        if (!rawTags.length) return;

        const recognizedIndices = new Set(); // ДОБАВЛЕНО: Индексы распознанных тегов в массиве rawTags
        let lastIdx = -1;

        // Вспомогательная функция для кольцевого поиска
        const findRingIndex = (indices) => {
            if (!indices) return -1;
            const sorted = [...indices].sort((a, b) => a - b);
            const after = sorted.find(i => i > lastIdx);
            return after !== undefined ? after : sorted.find(i => i <= lastIdx);
        };

        rawTags.forEach((tNameOriginal, tagIndex) => { // ИЗМЕНЕНО: Итерируем по rawTags с индексом
            const tName = tNameOriginal.toLowerCase(); // ИЗМЕНЕНО: Переводим в нижний регистр только для поиска
            let foundIndex = -1;

            // tName уже в нижнем регистре

            // 1. Поиск по имени
            if (this.tagIndexMap.has(tName)) {
                foundIndex = findRingIndex(this.tagIndexMap.get(tName));
            }

            // 2. Поиск по knownAs
            if ((foundIndex === -1 || foundIndex === undefined) && this.knownAsMap.has(tName)) {
                foundIndex = findRingIndex(this.knownAsMap.get(tName));
            }

            // 3. Альтернативный поиск
            if ((foundIndex === -1 || foundIndex === undefined) && this.altTagSearchMap.has(tName)) {
                foundIndex = findRingIndex(this.altTagSearchMap.get(tName));
            }

            // Применение результата (логика не меняется)
            if (foundIndex !== -1 && foundIndex !== undefined) {
                const info = this.allTagsInOrder[foundIndex];
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
                lastIdx = foundIndex;
                recognizedIndices.add(tagIndex); // ДОБАВЛЕНО: Отмечаем индекс как распознанный
            }
        });

        // ДОБАВЛЕНО: Сбор нераспознанных тегов
        this.unrecognizedTags = rawTags.filter((_, index) => !recognizedIndices.has(index));
    }

    updateUI() {
        const res = [];
        this.tagsData.categories.forEach(cfg => {
            const cat = this.categories.get(cfg.name);
            const process = (main) => res.push(cat.selectedVariants.get(main) || main);

            if (cat.type === 'ordered') cat.orderedTags.forEach(process);
            else if (cat.type === 'single') { if (cat.selectedTags.size) process([...cat.selectedTags][0]); }
            else {
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
            this.parseInput(this.dom.input.value);
        } else {
            this.dom.input.value = resStr;
        }

        this.dom.limitDisp.textContent = `${resStr.length}/${limit}`;
        this.dom.limitDisp.classList.toggle('exceeded', isLim && resStr.length > limit);

        // ДОБАВЛЕНО: Обновление предупреждения о нераспознанных тегах
        const { unrecWarn } = this.dom;
        if (this.unrecognizedTags.length > 0) {
            const unrecStr = this.unrecognizedTags.join(', '); // Формат: <теги через ,>
            unrecWarn.textContent = `Не распознано: ${unrecStr}`;
            unrecWarn.classList.remove('util-hidden');
        } else {
            unrecWarn.classList.add('util-hidden');
        }

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
                txt = cat.overrideRequirementText || 'Необходимо выбрать хотя бы один главный тег';
            } else if (cat.requirement === 'atLeastOneMain') {
                showWarn = ![...cat.selectedTags].some(m => cat.tags.get(m).isMainTag);
                txt = cat.overrideRequirementText || 'Необходимо выбрать хотя бы один главный тег';
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
            const iter = (m) => add(cat.tags.get(cat.selectedVariants.get(m) || m));
            if (cat.type === 'ordered') cat.orderedTags.forEach(iter);
            else if (cat.type === 'single') { if (cat.selectedTags.size) iter([...cat.selectedTags][0]); }
            else {
                cfg.tags.forEach(t => {
                    const m = Array.isArray(t.name) ? t.name[0] : t.name;
                    if (cat.selectedTags.has(m)) {
                        const selectedName = cat.selectedVariants.get(m);
                        add(cat.tags.get(selectedName || m));
                    }
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

    showUI() { this.dom.loading.classList.add('util-hidden'); this.dom.error.classList.add('util-hidden'); this.dom.app.classList.remove('util-hidden'); }

    error(detailText, title = 'Ошибка загрузки конфигурации') {
        this.dom.loading.classList.add('util-hidden');
        this.dom.errTitle.textContent = title;
        this.dom.errDetail.innerHTML = detailText.replace(/\*\*(.*?)\*\*/g, '<code>$1</code>');
        this.dom.error.classList.remove('util-hidden');
        this.dom.app.classList.add('util-hidden');
    }
}

document.addEventListener('DOMContentLoaded', () => new TagsManager());