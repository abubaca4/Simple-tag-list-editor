// Перехватываем URL текущего скрипта во время его выполнения
const currentScriptUrl = document.currentScript?.src ?? '';
// Извлекаем значение параметра v (например, "7" из "?v=7")
const versionMatch = currentScriptUrl.match(/[?&]v=([^&]+)/);
const APP_VERSION = versionMatch?.[1] ?? 'unknown';

class TagsManager {
  constructor() {
    // Начинает асинхронную загрузку конфигурационного файла tags.json
    this.dataPromise = this.startLoadingData();

    this.tagsData = null;
    this.selectedTags = new Map();
    this.categories = new Map();
    this.allTagsInOrder = [];
    this.tagIndexMap = new Map();
    this.knownAsMap = new Map();
    this.altTagSearchMap = new Map();
    this.unrecognizedTags = [];
    this.unrecognizedIgnoreSet = new Set();
    this.isHeaderPinned = true;
    this.dom = {};
    this.scrollTicking = false;

    this.themeState = "auto";
    this.themeIcons = { auto: "🌓", dark: "🌙", light: "☀️" };
    this.themeTexts = { auto: "Авто", dark: "Тёмная", light: "Светлая" };

    // Управление режимом отображения тегов: "text" или "image".
    this.displayMode = "text";
    this.imageTagCount = 0;
    this.isImageOnly = false;

    // Флаг для проверки наличия лимита
    this.hasCharacterLimit = false;

    // Переменные для поиска
    this.isSearchActive = false;
    this.searchResults = [];
    this.currentSearchIndex = 0;

    // Запускает главную последовательность инициализации
    this.initialize();
  }

  // ==========================================
  // 1. ИНИЦИАЛИЗАЦИЯ И НАСТРОЙКА
  // ==========================================

  async initialize() {
    try {
      this.cacheDOM();
      this.setupStaticEvents();

      try {
        this.tagsData = await this.dataPromise;

        if (Array.isArray(this.tagsData.unrecognizedIgnore)) {
          this.unrecognizedIgnoreSet = new Set(
            this.tagsData.unrecognizedIgnore.map((t) => t.trim().toLowerCase()),
          );
        }

        this.generateHighlightCSS();

        this.hasCharacterLimit = (this.tagsData?.characterLimit ?? 0) > 0;

        const mode = (this.tagsData.imageMode ?? "textFirst").toString();
        this.displayMode = mode === "textFirst" ? "text" : "image";
        this.isImageOnly = mode === "imageOnly";

        if (this.tagsData.hideInputSection) {
          this.dom.input.classList.add("util-hidden");
          this.dom.copyBtn.classList.add("util-hidden");
        }

        this.initWebLinks();
      } catch (e) {
        this.handleLoadError(e);
        return;
      }

      this.showUI();
      this.initCategories();
      this.resolveRequiredTags();
      this.render();
      this.updateDisplayToggleVisibility();

      const savedState = this.loadStateFromStorage();
      const initialValue = savedState?.trim() ? savedState : this.dom.input.value;

      if (initialValue) {
        this.parseInput(initialValue, true);
      }

      this.dom.limitBox.parentElement.classList.toggle("util-hidden", !this.hasCharacterLimit);
      if (this.hasCharacterLimit) {
        this.updateLimitDisplay(this.dom.input.value.length);
      }

      this.updateFullState();
      this.updateAlt();
    } catch (e) {
      console.error(e);
      if (!this.dom.error.classList.contains("util-hidden")) return;
      this.error(`Критическая ошибка инициализации: ${e.message}`, "Критическая ошибка");
    }
  }

  cacheDOM() {
    const id = (x) => document.getElementById(x);
    this.dom = {
      loading: id("loadingMessage"),
      error: id("errorMessage"),
      errDetail: id("errorDetails"),
      errTitle: id("errorTitle"),
      app: id("appContainer"),
      input: id("tagsInput"),
      mainInputWrap: id("mainInputWrapper"),
      copyBtn: id("copyBtn"),
      clearBtn: id("clearBtn"),
      copyAltBtn: id("copyAltBtn"),
      unrecWarn: id("unrecognizedTagsWarning"),
      limitBox: id("limitCheckbox"),
      limitDisp: id("limitDisplay"),
      altSection: id("alternativeSection"),
      altOut: id("alternativeOutput"),
      altName: id("alternativeName"),
      dupBox: id("removeDuplicatesCheckbox"),
      container: id("tagsContainer"),
      nav: id("categoriesNav"),
      navList: id("categoriesNavList"),
      pinBtn: id("pinHeaderButton"),
      pinText: id("pinHeaderButton").querySelector(".toggle-text"),
      header: document.querySelector(".header-panel"),
      main: id("mainContainer"),
      scrollHints: [id("leftScrollHint"), id("rightScrollHint")],
      refSection: id("referenceSection"),
      refToggleBtn: id("toggleReferenceButton"),
      refContent: id("referenceContent"),
      webLinksNav: id("webLinksNav"),
      globalCatWarn: id("globalCategoryWarning"),
      themeToggleBtn: id("themeToggleButton"),
      themeIcon: id("themeToggleButton").querySelector(".toggle-icon"),
      themeText: id("themeToggleButton").querySelector(".toggle-text"),
      displayModeBtn: id("displayModeButton"),
      displayIcon: id("displayModeButton").querySelector(".toggle-icon"),
      displayText: id("displayModeButton").querySelector(".toggle-text"),
      searchToggleBtn: id("searchToggleButton"),
      searchIcon: id("searchToggleButton").querySelector(".toggle-icon"),
      searchText: id("searchToggleButton").querySelector(".toggle-text"),
      searchInputWrap: id("searchInputWrapper"),
      searchInput: id("tagSearchInput"),
      searchPrevBtn: id("searchPrevBtn"),
      searchNextBtn: id("searchNextBtn"),
    };
  }

  setupStaticEvents() {
    const {
      input, limitBox, dupBox, pinBtn, main, header, container,
      themeToggleBtn, displayModeBtn, unrecWarn, refToggleBtn, refContent
    } = this.dom;

    input.addEventListener("input", () => {
      const newValue = input.value;
      const oldValue = this.loadStateFromStorage() || "";

      let shouldSkipParsing = false;
      if (newValue.startsWith(oldValue)) {
        const diff = newValue.substring(oldValue.length);
        if (/^[,\s]+$/.test(diff)) shouldSkipParsing = true;
      }

      if (!shouldSkipParsing) {
        unrecWarn.classList.add("util-hidden");
        this.parseInput(newValue, true);
        this.updateUI(false);
        this.saveStateToStorage();
      }
    });

    this.dom.copyBtn.addEventListener("click", async () => {
      try {
        if (this.dom.input.value.replace(/\s+/g, "") !== "") {
          await navigator.clipboard.writeText(this.dom.input.value);
          if (!this.dom.altSection.classList.contains("util-hidden")) {
            this.scrollToElement(this.dom.altSection, 30);
          }
        }
      } catch (err) {
        console.error("Ошибка при копировании: ", err);
      }
    });

    this.dom.clearBtn.addEventListener("click", () => {
      this.dom.input.value = "";
      this.dom.input.focus();
      unrecWarn.classList.add("util-hidden");
      this.parseInput("", true);
      this.updateUI(false);
      this.saveStateToStorage();
    });

    this.dom.copyAltBtn.addEventListener("click", async () => {
      try {
        if (this.dom.altOut.value.replace(/\s+/g, "") !== "") {
          await navigator.clipboard.writeText(this.dom.altOut.value);
        }
      } catch (err) {
        console.error("Ошибка при копировании альтернативных тегов: ", err);
      }
    });

    limitBox.addEventListener("change", () => this.updateUI(true));
    dupBox.addEventListener("change", () => this.updateAlt());

    refToggleBtn.addEventListener("click", () => {
      const isHidden = refContent.classList.toggle("util-hidden");
      refToggleBtn.textContent = isHidden ? "Важная информация" : "Скрыть";
      if (this.isHeaderPinned) this.updateHeaderOffset();
    });

    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".tag-button");
      if (!btn) return;
      const catName = btn.closest(".category").querySelector(".category-title").textContent;
      const tagName = (e.target.tagName === "IMG" && btn.dataset.mainname) ? btn.dataset.mainname : (btn.dataset.name || btn.textContent);
      this.handleTagClick(catName, tagName);
    });

    pinBtn.addEventListener("click", () => {
      this.isHeaderPinned = !this.isHeaderPinned;
      this.updatePinState();
      localStorage.setItem("headerPinned", this.isHeaderPinned);
    });

    const savedPinned = localStorage.getItem("headerPinned");
    this.isHeaderPinned = savedPinned !== null ? JSON.parse(savedPinned) : true;

    displayModeBtn.addEventListener("click", () => this.toggleTagDisplayMode());

    themeToggleBtn.addEventListener("click", () => this.toggleTheme());
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme) {
      this.themeState = savedTheme;
      this.applyTheme();
    }

    this.dom.searchToggleBtn.addEventListener("click", () => this.toggleSearchMode());
    this.dom.searchInput.addEventListener("input", () => this.performSearch());
    this.dom.searchPrevBtn.addEventListener("click", () => this.navigateSearch(-1));
    this.dom.searchNextBtn.addEventListener("click", () => this.navigateSearch(1));

    this.dom.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault();
        this.navigateSearch(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.navigateSearch(-1);
      }
    });

    const updateLayoutDebounced = () => {
      if (!this.scrollTicking) {
        window.requestAnimationFrame(() => {
          this.updateNavVis();
          this.updateScrollHints();
          if (this.isHeaderPinned) this.updateHeaderOffset();
          this.scrollTicking = false;
        });
        this.scrollTicking = true;
      }
    };

    window.addEventListener("resize", updateLayoutDebounced);
    window.addEventListener("scroll", updateLayoutDebounced);

    document.body.addEventListener("mousedown", (e) => {
      if (!main.contains(e.target) && !header.contains(e.target) && !e.target.closest(".scroll-hint")) {
        if (window.scrollY > 300) window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    this.dom.scrollHints.forEach((h) =>
      h.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" })),
    );
  }

  initCategories() {
    this.categories.clear();
    this.allTagsInOrder = [];
    this.tagIndexMap.clear();
    this.knownAsMap.clear();
    this.altTagSearchMap.clear();

    this.tagsData.categories.forEach((cat) => {
      const catData = {
        ...cat,
        requirement: cat.requirement || [],
        overrideRequirementText: cat.overrideRequirementText || "",
        tags: new Map(),
        selectedTags: new Set(),
        orderedTags: [],
        variantGroups: new Map(),
        selectedVariants: new Map(),
        dom: null,
      };

      cat.tags.forEach((t) => {
        const names = [t.name].flat();
        const main = names[0];
        if (names.length > 1) catData.variantGroups.set(main, names);

        const imageUrl = t.image || null;
        const tagHighlights = [t.highlight].flat().filter(Boolean);
        let highestPriorityIndex = -1;
        let highestPriorityWeight = 0;

        if (Array.isArray(this.tagsData.highlightedTags)) {
          for (const hName of tagHighlights) {
            const index = this.tagsData.highlightedTags.findIndex(h => h.name === hName);
            if (index !== -1) {
              const weight = this.tagsData.highlightedTags.length - index;
              if (weight > highestPriorityWeight) {
                highestPriorityWeight = weight;
                highestPriorityIndex = index;
              }
            }
          }
        }

        names.forEach((name) => {
          catData.tags.set(name, {
            name, mainName: main, alternative: t.alternative || "",
            subgroup: t.subgroup || "", description: t.description || "",
            image: imageUrl, isVariant: name !== main, knownAs: t.knownAs || [],
            requiredTag: t.requiredTag || null, highlights: tagHighlights,
            displayHighlightIndex: highestPriorityIndex, sortWeight: highestPriorityWeight
          });

          const tagInfo = { name, mainName: main, category: cat.name, catData, tagConfig: t };
          this.allTagsInOrder.push(tagInfo);
          const currentIndex = this.allTagsInOrder.length - 1;
          const lowerName = name.toLowerCase();

          if (!this.tagIndexMap.has(lowerName)) this.tagIndexMap.set(lowerName, []);
          this.tagIndexMap.get(lowerName).push(currentIndex);

          if (Array.isArray(t?.knownAs)) {
            t.knownAs.forEach((alias) => {
              const cleanAlias = alias.trim().toLowerCase();
              if (!this.knownAsMap.has(cleanAlias)) this.knownAsMap.set(cleanAlias, []);
              this.knownAsMap.get(cleanAlias).push(currentIndex);
            });
          }

          if (names.length === 1 && name.includes("/")) {
            this.generateAltNames(name).forEach((altName) => {
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

  resolveRequiredTags() {
    this.categories.forEach((catData) => {
      catData.tags.forEach((tag) => {
        if (!tag.requiredTag) return;
        const rawRequirements = [tag.requiredTag].flat();
        tag.resolvedRequiredTags = [];

        rawRequirements.forEach((req) => {
          let targetCat = null;
          let targetTagName = "";

          if (typeof req === "string") {
            targetCat = catData;
            targetTagName = req;
          } else if (req?.category && req?.name) {
            targetCat = this.categories.get(req.category);
            targetTagName = req.name;
          }

          if (targetCat?.tags.has(targetTagName)) {
            tag.resolvedRequiredTags.push({ category: targetCat, tagName: targetTagName });
          }
        });
      });
    });
  }

  initWebLinks() {
    const { webLinksNav } = this.dom;
    webLinksNav.innerHTML = "";

    if (this.tagsData?.webLinks?.length > 0) {
      const urlParams = new URLSearchParams(window.location.search);
      const allowedButtons = urlParams.get("linkbutton")?.split(",").map(s => s.trim()) ?? [];
      let addedLinksCount = 0;

      this.tagsData.webLinks.forEach((link) => {
        if (!link.fName || allowedButtons.includes(link.fName)) {
          const target = link.target || "_blank";
          const linkAttrs = { href: link.url, target };
          if (target === "_blank") linkAttrs["rel"] = "noopener noreferrer";
          webLinksNav.appendChild(this.el("a", "web-link-item", link.name, linkAttrs));
          addedLinksCount++;
        }
      });
      webLinksNav.classList.toggle("util-hidden", addedLinksCount === 0);
    } else {
      webLinksNav.classList.add("util-hidden");
    }
  }

  // ==========================================
  // 2. ДАННЫЕ И КЭШИРОВАНИЕ
  // ==========================================

  getCacheMetadata(fileName, action = "get", data = {}) {
    const key = `tagsManagerCacheMeta:${fileName}`;
    if (action === "get") {
      try {
        return JSON.parse(localStorage.getItem(key)) ?? {};
      } catch (e) {
        return {};
      }
    } else if (action === "set") {
      const currentData = this.getCacheMetadata(fileName);
      const newData = {
        cacheMaxAgeHours: data.cacheMaxAgeHours ?? currentData.cacheMaxAgeHours ?? 24,
        lastSuccessfulFetchTime: data.newContent ? Date.now() : (currentData.lastSuccessfulFetchTime ?? 0),
        scriptVersion: APP_VERSION
      };
      localStorage.setItem(key, JSON.stringify(newData));
      return newData;
    }
    return {};
  }

  async startLoadingData() {
    const getParams = () => {
      const p = new URLSearchParams(window.location.search).get("conf");
      return p && !p.endsWith(".json") ? `${p}.json` : (p || "tags.json");
    };

    this.configFileName = getParams();

    const fetchFile = async (f, fetchMode) => {
      const r = await fetch(f, { cache: fetchMode });
      if (!r.ok) throw new Error(`Файл не найден (статус: ${r.status})`);
      const json = await r.json();
      this.getCacheMetadata(f, "set", { cacheMaxAgeHours: json.cacheMaxAgeHours, newContent: true });
      return json;
    };

    let cacheMeta = this.getCacheMetadata(this.configFileName);
    const lastFetchTime = cacheMeta.lastSuccessfulFetchTime || 0;
    const maxAgeMs = (cacheMeta.cacheMaxAgeHours || 24) * 60 * 60 * 1000;

    const isCacheExpired = lastFetchTime === 0 || Date.now() - lastFetchTime > maxAgeMs;
    const isVersionChanged = cacheMeta.scriptVersion !== APP_VERSION;
    const fetchMode = (isCacheExpired || isVersionChanged) ? "no-cache" : "default";

    try {
      return await fetchFile(this.configFileName, fetchMode);
    } catch (e) {
      if (this.configFileName !== "tags.json") {
        try {
          return await fetchFile("tags.json", "no-cache");
        } catch (fallbackErr) {
          throw e;
        }
      }
      throw e;
    }
  }

  saveStateToStorage() {
    if (this.configFileName) {
      localStorage.setItem(`tagsManager_autosave:${this.configFileName}`, this.dom.input.value);
    }
  }

  loadStateFromStorage() {
    return this.configFileName ? localStorage.getItem(`tagsManager_autosave:${this.configFileName}`) : null;
  }

  // ==========================================
  // 3. ПАРСИНГ
  // ==========================================

  parseInput(str, updateInputValue = true) {
    this.selectedTags.clear();
    this.categories.forEach((c) => {
      c.selectedTags.clear();
      c.orderedTags = [];
      c.selectedVariants.clear();
    });

    const processedStr = str.trim() + " ";
    const rawTags = processedStr.split(this.tagsData.separator).map((t) => t.trim()).filter(Boolean);
    const recognizedIndices = new Set();

    const findTagInMaps = (term) => {
      return this.tagIndexMap.get(term) || this.knownAsMap.get(term) || this.altTagSearchMap.get(term) || null;
    };

    rawTags.forEach((tNameOriginal, tagIndex) => {
      const foundIndicesArray = findTagInMaps(tNameOriginal.toLowerCase());
      if (foundIndicesArray) {
        foundIndicesArray.forEach((foundIndex) => {
          const info = this.allTagsInOrder[foundIndex];
          const cat = info.catData;
          const main = info.mainName;

          if (cat.type === "single") {
            cat.selectedTags.forEach((m) => this.selectedTags.delete(m));
            cat.selectedTags.clear();
            cat.selectedTags.add(main);
          } else {
            cat.selectedTags.add(main);
            if (cat.type === "ordered" && !cat.orderedTags.includes(main)) cat.orderedTags.push(main);
          }
          cat.selectedVariants.set(main, info.name);
          this.selectedTags.set(main, info.category);
        });
        recognizedIndices.add(tagIndex);
      }
    });

    this.unrecognizedTags = rawTags.filter(
      (tagStr, index) => !recognizedIndices.has(index) && !this.unrecognizedIgnoreSet.has(tagStr.toLowerCase())
    );

    if (updateInputValue) this.dom.input.value = this.generateOutputString();
  }

  generateOutputString() {
    const res = [];
    this.processSelectedTags((name) => res.push(name));
    return res.join(this.tagsData.separator);
  }

  processSelectedTags(callback) {
    this.tagsData.categories.forEach((cfg) => {
      const cat = this.categories.get(cfg.name);
      const run = (main) => {
        const variantName = cat.selectedVariants.get(main) || main;
        const tagObj = cat.tags.get(variantName);
        if (tagObj) callback(variantName, tagObj);
      };

      if (cat.type === "ordered") {
        cat.orderedTags.forEach(run);
      } else if (cat.type === "single") {
        if (cat.selectedTags.size) run([...cat.selectedTags][0]);
      } else {
        cfg.tags.forEach((t) => {
          const main = Array.isArray(t.name) ? t.name[0] : t.name;
          if (cat.selectedTags.has(main)) run(main);
        });
      }
    });
  }

  handleTagClick(catName, tagName) {
    const cat = this.categories.get(catName);
    const tag = cat.tags.get(tagName);
    const main = tag.mainName;

    const snapshot = {
      selectedTags: new Set(cat.selectedTags),
      orderedTags: [...cat.orderedTags],
      selectedVariants: new Map(cat.selectedVariants),
    };

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

    if (cat.type === "single") {
      const isActive = cat.selectedTags.has(main);
      cat.selectedTags.forEach((m) => this.selectedTags.delete(m));
      cat.selectedTags.clear();
      cat.selectedVariants.clear();
      if (!isActive) setSel(tagName);
    } else if (cat.type === "ordered") {
      if (cat.selectedTags.has(main)) {
        cat.orderedTags = cat.orderedTags.filter((t) => t !== main);
        delSel();
      } else {
        cat.orderedTags.push(main);
        setSel(tagName);
      }
      cat.orderedTags.sort((a, b) => cat.tags.get(b).sortWeight - cat.tags.get(a).sortWeight);
    } else {
      const curVar = cat.selectedVariants.get(main);
      if (cat.selectedTags.has(main) && curVar === tagName) delSel();
      else setSel(tagName);
    }

    if (cat.selectedTags.has(main) && tag.resolvedRequiredTags) {
      this.processRequiredTag(tag.resolvedRequiredTags);
    }

    if (this.hasCharacterLimit) {
      const newStr = this.generateOutputString();
      if (this.dom.limitBox.checked && newStr.length > this.tagsData.characterLimit) {
        cat.selectedTags.forEach((m) => this.selectedTags.delete(m));
        cat.selectedTags = snapshot.selectedTags;
        cat.orderedTags = snapshot.orderedTags;
        cat.selectedVariants = snapshot.selectedVariants;
        cat.selectedTags.forEach((m) => this.selectedTags.set(m, catName));
        this.flashLimitError();
        return;
      }
    }

    const newStr = this.generateOutputString();
    this.dom.input.value = newStr;
    this.saveStateToStorage();
    this.updateLimitDisplay(newStr.length);
    this.updateCategoryDOM(cat);
    this.updateAlt();
  }

  processRequiredTag(resolvedTags) {
    resolvedTags.forEach(({ category, tagName }) => {
      const targetMain = category.tags.get(tagName).mainName;
      if (category.selectedTags.has(targetMain)) return;

      category.selectedTags.add(targetMain);
      this.selectedTags.set(targetMain, category.name);
      category.selectedVariants.set(targetMain, tagName);

      if (category.type === "ordered") {
        category.orderedTags.push(targetMain);
        category.orderedTags.sort((a, b) => category.tags.get(b).sortWeight - category.tags.get(a).sortWeight);
      }
      this.updateCategoryDOM(category);
    });
  }

  groupTags(catData) {
    const subs = new Map();
    const processed = new Set();
    catData.tags.forEach((tag) => tag.domButtons = []);

    catData.variantGroups.forEach((vars, main) => {
      const tag = catData.tags.get(vars[0]);
      if (!tag) return;
      const s = tag.subgroup || "";
      if (!subs.has(s)) subs.set(s, []);
      subs.get(s).push({ type: "variant", variants: vars.map((v) => catData.tags.get(v)), desc: tag.description });
      processed.add(main);
    });

    catData.tags.forEach((tag) => {
      if (tag.isVariant || processed.has(tag.mainName)) return;
      const s = tag.subgroup || "";
      if (!subs.has(s)) subs.set(s, []);
      subs.get(s).push({ type: "single", tag });
    });

    return subs;
  }

  generateAltNames(name) {
    const parts = name.split(/\s+/).map((p) => p.split("/").filter(Boolean));
    const combine = (arr, index = 0, current = []) => {
      if (index === arr.length) return [current.join(" ").trim()];
      let results = [];
      for (const item of arr[index]) {
        results.push(...combine(arr, index + 1, [...current, item]));
      }
      return results;
    };
    return combine(parts).filter(Boolean);
  }

  // ==========================================
  // 4. ГЕНЕРАЦИЯ И ОБНОВЛЕНИЕ DOM (РЕНДЕР)
  // ==========================================

  render() {
    this.imageTagCount = 0;
    const { container, navList, refSection, refContent, refToggleBtn } = this.dom;

    container.innerHTML = "";
    navList.innerHTML = "";

    const referenceHtml = this.tagsData.reference || "";
    if (referenceHtml) {
      refContent.innerHTML = referenceHtml;
      refSection.classList.remove("util-hidden");
      refContent.classList.add("util-hidden");
      refToggleBtn.textContent = "Важная информация";
    } else {
      refSection.classList.add("util-hidden");
    }
    delete this.tagsData.reference;

    const categoriesFragment = document.createDocumentFragment();
    const navFragment = document.createDocumentFragment();

    this.categories.forEach((catData, catName) => {
      const catDiv = this.el("div", "category");
      catData.dom = catDiv;

      const titleRow = this.el("div", "category-title-container");
      const left = this.el("div", "category-title-left");
      left.append(this.el("div", "category-title", catName));
      if (catData.description) {
        left.append(this.el("button", "category-help-button", "?", { "data-tooltip": catData.description }));
      }

      let catRefContent = null;
      if (catData.reference) {
        const refButton = this.el("button", "util-tag-base pin-header-button", "Справка");
        left.append(refButton);
        catRefContent = this.el("div", "reference-content util-hidden", "");
        catRefContent.innerHTML = catData.reference;
        refButton.onclick = () => {
          const isHidden = catRefContent.classList.toggle("util-hidden");
          refButton.textContent = isHidden ? "Справка" : "Скрыть";
          if (this.isHeaderPinned) this.updateHeaderOffset();
        };
      }
      delete catData.reference;

      const right = this.el("div", "category-title-right");
      if (catData.label?.text) {
        const labelEl = this.el("div", "category-label", catData.label.text);
        if (catData.label.light) labelEl.style.setProperty("--label-light-color", catData.label.light);
        if (catData.label.dark) labelEl.style.setProperty("--label-dark-color", catData.label.dark);
        right.append(labelEl);
      }

      const scrollTop = this.el("button", "category-scroll-top", "˄", { "aria-label": "Наверх" });
      scrollTop.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
      right.append(scrollTop);
      titleRow.append(left, right);

      const warnEl = this.el("div", "category-warning util-hidden");
      catData.warnDom = warnEl;

      catDiv.append(titleRow);
      if (catRefContent) catDiv.append(catRefContent);
      catDiv.append(warnEl);

      this.groupTags(catData).forEach((tags, subName) => {
        const subDiv = this.el("div", "subgroup");
        if (subName && !subName.startsWith("!")) subDiv.append(this.el("div", "subgroup-title", subName));

        const groupDiv = this.el("div", "tags-group");
        tags.forEach((item) => {
          if (item.type === "variant") {
            const vGroup = this.el("div", "variant-group");
            const vBtns = this.el("div", "variant-buttons");
            item.variants.forEach((t) => vBtns.append(this.createBtn(t)));
            vGroup.append(vBtns);
            if (item.desc) vGroup.append(this.el("div", "variant-description", item.desc));
            groupDiv.append(vGroup);
          } else {
            groupDiv.append(this.createBtn(item.tag));
          }
        });
        subDiv.append(groupDiv);
        catDiv.append(subDiv);
      });

      categoriesFragment.appendChild(catDiv);

      const navItem = this.el("button", "category-nav-item", catName);
      navItem.onclick = () => this.scrollToElement(catDiv, 30);
      catData.navBtn = navItem;
      navFragment.appendChild(navItem);
    });

    container.appendChild(categoriesFragment);
    navList.appendChild(navFragment);
    this.updateNavVis();
    this.updatePinState();
  }

  createBtn(tag) {
    let cssClass = `tag-button util-tag-base`;
    if (tag.displayHighlightIndex !== -1) cssClass += ` highlight-${tag.displayHighlightIndex}`;
    if (tag.image) cssClass += " has-image";

    const btn = this.el("button", cssClass, "", {
      "data-tooltip": tag.description || "",
      "data-name": tag.name,
      "data-mainname": tag.mainName || tag.name,
    });

    const textSpan = this.el("span", "tag-text", tag.name);
    btn.appendChild(textSpan);

    if (tag.image) {
      const img = this.el("img", "tag-image");
      img.src = tag.image;
      img.alt = tag.name;
      btn.appendChild(img);
      this.imageTagCount += 1;

      if (this.displayMode === "text") img.classList.add("util-hidden");
      else textSpan.classList.add("util-hidden");
    }

    if (!tag.domButtons) tag.domButtons = [];
    tag.domButtons.push(btn);
    return btn;
  }

  generateHighlightCSS() {
    if (!Array.isArray(this.tagsData.highlightedTags)) return;
    let lightVars = '', darkVars = '', classes = '';

    this.tagsData.highlightedTags.forEach((h, index) => {
      const cls = `highlight-${index}`;

      if (h.light) {
        if (h.light.bg) lightVars += `--${cls}-bg: ${h.light.bg}; `;
        if (h.light.border) lightVars += `--${cls}-border: ${h.light.border}; `;
        if (h.light.text) lightVars += `--${cls}-text: ${h.light.text}; `;
      }

      const themeFallback = h.dark ?? h.light;
      if (themeFallback) {
        if (themeFallback.bg) darkVars += `--${cls}-bg: ${themeFallback.bg}; `;
        if (themeFallback.border) darkVars += `--${cls}-border: ${themeFallback.border}; `;
        if (themeFallback.text) darkVars += `--${cls}-text: ${themeFallback.text}; `;
      }

      classes += `
        .tag-button.${cls} { background-color: var(--${cls}-bg, transparent); border-color: var(--${cls}-border, transparent); color: var(--${cls}-text, inherit); font-weight: normal; }
        .tag-button.${cls}.selected { background-color: var(--selected-bg); border-color: var(--selected-border); color: var(--text-color); }
        .${cls}-text { color: var(--${cls}-text, inherit); font-weight: bold; }
      `;
    });

    const style = document.createElement('style');
    style.textContent = `:root { ${lightVars} } [data-theme="dark"] { ${darkVars} } @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${darkVars} } } ${classes}`;
    document.head.appendChild(style);
  }

  updateCategoryDOM(cat) {
    this.updateButtonsInContainer(cat.dom, cat);
    this.refreshGlobalWarning();
  }

  updateFullState() {
    this.categories.forEach((cat) => this.updateButtonsInContainer(cat.dom, cat));
    this.refreshGlobalWarning();
    this.updateDisplayToggleVisibility();
  }

  updateButtonsInContainer(container, cat) {
    cat.tags.forEach((tag) => {
      if (tag.domButtons?.length > 0) {
        tag.domButtons.forEach((btn) => {
          const sel = cat.selectedTags.has(tag.mainName) && cat.selectedVariants.get(tag.mainName) === tag.name;
          btn.classList.toggle("selected", sel);

          if (cat.type === "ordered" && sel) {
            const order = cat.orderedTags.indexOf(tag.mainName) + 1;
            if (btn.getAttribute("data-order") != order) {
              btn.classList.add("ordered");
              btn.setAttribute("data-order", order);
            }
          } else {
            btn.classList.remove("ordered");
            btn.removeAttribute("data-order");
          }
        });
      }
    });

    const warn = cat.warnDom;
    let showWarn = false;
    let txtHtml = "";
    const reqs = [cat.requirement].flat().filter(Boolean);

    if (reqs.some(r => r !== "atLeastOne")) {
      const requiredHighlights = reqs.filter(r => r !== "atLeastOne");
      const missingHighlights = [];

      requiredHighlights.forEach(reqHighlight => {
        const hasTagWithHighlight = [...cat.tags.values()].some(tag => tag.highlights.includes(reqHighlight));
        if (hasTagWithHighlight) {
          const isSatisfied = [...cat.selectedTags].some(mainName => cat.tags.get(mainName)?.highlights.includes(reqHighlight));
          if (!isSatisfied) missingHighlights.push(reqHighlight);
        }
      });

      if (missingHighlights.length > 0) {
        showWarn = true;
        if (cat.overrideRequirementText) {
          txtHtml = cat.overrideRequirementText;
        } else {
          const styledNames = missingHighlights.map(name => {
            const idx = (this.tagsData.highlightedTags || []).findIndex(h => h.name === name);
            return idx !== -1 ? `<span class="highlight-${idx}-text">${name}</span>` : name;
          });
          const namesStr = styledNames.length > 1 ? `${styledNames.slice(0, -1).join(", ")} и ${styledNames.slice(-1)}` : styledNames[0];
          txtHtml = `Необходимо выбрать хотя бы один тег из ${namesStr}`;
        }
      }
    } else if (reqs.includes("atLeastOne")) {
      showWarn = cat.selectedTags.size === 0;
      txtHtml = cat.overrideRequirementText || "Необходимо выбрать хотя бы один тег";
    }

    if (warn.innerHTML !== txtHtml) warn.innerHTML = txtHtml;
    warn.classList.toggle("util-hidden", !showWarn);
    if (cat.navBtn) cat.navBtn.classList.toggle("nav-item-error", showWarn);
    cat.hasError = showWarn;
    return showWarn;
  }

  // ==========================================
  // 5. UI И ИНТЕРАКТИВНОСТЬ
  // ==========================================

  updateUI(updateInputFromState = true) {
    if (updateInputFromState) this.dom.input.value = this.generateOutputString();
    this.updateLimitDisplay(this.dom.input.value.length);

    this.dom.unrecWarn.textContent = `Не распознано: ${this.unrecognizedTags.join(", ")}`;
    this.dom.unrecWarn.classList.toggle("util-hidden", this.unrecognizedTags.length === 0);

    this.updateFullState();
    this.updateAlt();
  }

  updateLimitDisplay(len) {
    if (!this.hasCharacterLimit) return;
    const limit = this.tagsData.characterLimit;
    const isExceeded = this.dom.limitBox.checked && len > limit;
    this.dom.limitDisp.textContent = `${len}/${limit}`;
    this.dom.limitDisp.classList.toggle("exceeded", !!isExceeded);
  }

  flashLimitError() {
    if (!this.hasCharacterLimit) return;
    this.dom.limitDisp.classList.add("exceeded");
    const originalText = this.dom.limitDisp.textContent;
    this.dom.limitDisp.textContent = "ЛИМИТ!";
    setTimeout(() => {
      this.dom.limitDisp.textContent = originalText;
      this.updateLimitDisplay(this.dom.input.value.length);
    }, 800);
  }

  updateAlt() {
    const alts = [];
    const seen = new Set();
    let hasDuplicates = false;

    this.processSelectedTags((_, tagObj) => {
      if (tagObj.alternative) {
        const norm = tagObj.alternative.trim().toLowerCase().replace(/\s+/g, " ");
        alts.push(tagObj.alternative);
        if (seen.has(norm)) hasDuplicates = true;
        seen.add(norm);
      }
    });

    const dupControls = this.dom.dupBox.closest('.alternative-controls');
    dupControls.classList.toggle('util-hidden', !hasDuplicates);
    if (!hasDuplicates) this.dom.dupBox.checked = false;

    const filteredAlts = [];
    if (this.dom.dupBox.checked) {
      seen.clear();
      alts.forEach(alt => {
        const norm = alt.trim().toLowerCase().replace(/\s+/g, " ");
        if (!seen.has(norm)) {
          filteredAlts.push(alt);
          seen.add(norm);
        }
      });
    } else {
      filteredAlts.push(...alts);
    }

    const s = filteredAlts.join(this.tagsData.alternativeSeparator);
    const shouldBeVisible = s.length > 0;

    this.dom.altSection.classList.toggle("util-hidden", !shouldBeVisible);
    if (this.dom.altOut.value !== s) this.dom.altOut.value = s;

    this.dom.altName.textContent = this.tagsData.alternativeName || "";
    this.dom.altName.classList.toggle('util-hidden', !(this.tagsData.alternativeName && shouldBeVisible));

    if (shouldBeVisible && this.isHeaderPinned && !this.scrollTicking) {
      window.requestAnimationFrame(() => this.updateHeaderOffset());
    }
  }

  updateHeaderOffset() {
    if (!this.isHeaderPinned) {
      this.dom.main.style.paddingTop = "";
      return;
    }
    const target = `${this.dom.header.offsetHeight + 55}px`;
    if (this.dom.main.style.paddingTop !== target) this.dom.main.style.paddingTop = target;
  }

  updatePinState() {
    const act = this.isHeaderPinned;
    this.dom.pinBtn.classList.toggle("active", act);
    this.dom.header.classList.toggle("pinned", act);
    this.dom.main.classList.toggle("has-pinned-header", act);
    this.dom.pinText.textContent = act ? "Закреплено" : "Закрепить";
    this.updateNavVis();
    this.updateScrollHints();
    this.updateHeaderOffset();
  }

  updateNavVis() {
    const need = this.dom.main.scrollHeight > window.innerHeight || this.isHeaderPinned;
    this.dom.nav.classList.toggle("util-hidden", !need);
  }

  updateScrollHints() {
    const vis = window.innerWidth > this.dom.main.offsetWidth + 200 && window.scrollY > 100;
    this.dom.scrollHints.forEach((h) => h.classList.toggle("visible", vis));
  }

  refreshGlobalWarning() {
    const hasAnyError = [...this.categories.values()].some((cat) => cat.hasError);
    const isHidden = this.dom.globalCatWarn.classList.contains("util-hidden");
    this.dom.globalCatWarn.classList.toggle("util-hidden", !hasAnyError);
    if (isHidden !== !hasAnyError && this.isHeaderPinned) this.updateHeaderOffset();
  }

  toggleTheme() {
    const states = ["auto", "dark", "light"];
    this.themeState = states[(states.indexOf(this.themeState) + 1) % states.length];
    this.applyTheme();
    localStorage.setItem("theme", this.themeState);
  }

  applyTheme() {
    const html = document.documentElement;
    this.themeState === "auto" ? html.removeAttribute("data-theme") : html.setAttribute("data-theme", this.themeState);
    this.dom.themeIcon.textContent = this.themeIcons[this.themeState];
    this.dom.themeText.textContent = this.themeTexts[this.themeState];
    this.dom.themeToggleBtn.title = `Тема: ${this.themeTexts[this.themeState]}`;
  }

  updateDisplayToggleVisibility() {
    this.dom.displayModeBtn.classList.toggle("util-hidden", this.isImageOnly || this.imageTagCount === 0);
    if (!this.dom.displayModeBtn.classList.contains("util-hidden")) this.updateDisplayToggleIcon();
  }

  updateDisplayToggleIcon() {
    const showingText = this.displayMode === "text";
    this.dom.displayIcon.textContent = showingText ? "🔤" : "🖼️";
    this.dom.displayText.textContent = showingText ? "Текст" : "Иконки";
    this.dom.displayModeBtn.title = showingText ? "Показать изображения" : "Показать текст";
  }

  toggleTagDisplayMode() {
    const headerHeight = this.isHeaderPinned ? this.dom.header.offsetHeight : 0;
    const findFirstVisibleButton = () => {
      for (const btn of this.dom.container.querySelectorAll(".tag-button")) {
        const rect = btn.getBoundingClientRect();
        if (rect.bottom > headerHeight && rect.top < window.innerHeight) return btn;
      }
      return null;
    };

    const firstVisibleButton = findFirstVisibleButton();
    const desiredOffset = firstVisibleButton ? Math.max(headerHeight + 8, firstVisibleButton.getBoundingClientRect().top) : headerHeight + 8;

    this.displayMode = this.displayMode === "text" ? "image" : "text";
    this.updateDisplayToggleIcon();

    this.categories.forEach((cat) => {
      cat.tags.forEach((tag) => {
        if (tag.image && tag.domButtons) {
          tag.domButtons.forEach((btn) => {
            btn.querySelector(".tag-text")?.classList.toggle("util-hidden", this.displayMode !== "text");
            btn.querySelector(".tag-image")?.classList.toggle("util-hidden", this.displayMode === "text");
          });
        }
      });
    });

    requestAnimationFrame(() => {
      if (firstVisibleButton?.isConnected) {
        const targetScroll = Math.max(0, firstVisibleButton.getBoundingClientRect().top + window.scrollY - desiredOffset);
        window.scrollTo({ top: targetScroll, behavior: "auto" });
      }
      this.updateNavVis();
      this.updateScrollHints();
      if (this.isHeaderPinned) this.updateHeaderOffset();
    });
  }

  toggleSearchMode() {
    this.isSearchActive = !this.isSearchActive;
    this.dom.searchToggleBtn.classList.toggle("active", this.isSearchActive);
    this.dom.mainInputWrap.classList.toggle("util-hidden", this.isSearchActive);
    this.dom.searchInputWrap.classList.toggle("util-hidden", !this.isSearchActive);

    if (!this.isSearchActive) {
      this.clearSearch();
    } else {
      this.dom.searchInput.focus();
      this.performSearch();
    }
  }

  clearSearch() {
    this.dom.searchInput.value = "";
    this.searchResults = [];
    this.currentSearchIndex = 0;
    this.dom.searchInput.classList.remove("search-error-pulse");
    this.updateSearchHighlight();
  }

  performSearch() {
    const query = this.dom.searchInput.value.trim().toLowerCase();
    this.searchResults = [];
    this.currentSearchIndex = 0;

    if (!query) return this.clearSearch();

    this.categories.forEach((cat) => {
      cat.tags.forEach((tag) => {
        if ([tag.name].flat().some(name => name.toLowerCase().includes(query)) || tag.description?.toLowerCase().includes(query)) {
          if (tag.domButtons?.length > 0) this.searchResults.push(tag.domButtons[0]);
        }
      });
    });

    this.dom.searchInput.classList.toggle("search-error-pulse", this.searchResults.length === 0);
    this.updateSearchHighlight();
  }

  navigateSearch(direction) {
    if (this.searchResults.length === 0) return;
    this.currentSearchIndex = Math.max(0, Math.min(this.currentSearchIndex + direction, this.searchResults.length - 1));
    this.updateSearchHighlight();
  }

  updateSearchHighlight() {
    document.querySelectorAll(".search-match-active").forEach(btn => btn.classList.remove("search-match-active"));

    const total = this.searchResults.length;
    if (total === 0) {
      this.dom.searchPrevBtn.disabled = true;
      this.dom.searchNextBtn.disabled = true;
      return;
    }

    const activeBtn = this.searchResults[this.currentSearchIndex];
    if (activeBtn) {
      activeBtn.classList.add("search-match-active");
      this.scrollToElement(activeBtn, 30);
    }

    this.dom.searchPrevBtn.disabled = this.currentSearchIndex === 0;
    this.dom.searchNextBtn.disabled = this.currentSearchIndex === total - 1;
  }

  // ==========================================
  // 6. УТИЛИТЫ И ОБРАБОТКА ОШИБОК
  // ==========================================

  el(tag, cls = "", text = "", attrs = {}) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text) d.textContent = text;
    Object.entries(attrs).forEach(([k, v]) => d.setAttribute(k, v));
    return d;
  }

  scrollToElement(element, customOffset = 0) {
    if (!element) return;
    const offset = this.isHeaderPinned ? (this.dom.header.offsetHeight + customOffset) : 20;
    const top = element.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  }

  showUI() {
    this.dom.loading.classList.add("util-hidden");
    this.dom.error.classList.add("util-hidden");
    this.dom.app.classList.remove("util-hidden");
  }

  error(detailText, title = "Ошибка загрузки конфигурации") {
    this.dom.loading.classList.add("util-hidden");
    this.dom.errTitle.textContent = title;
    this.dom.errDetail.innerHTML = detailText.replace(/\*\*(.*?)\*\*/g, "<code>$1</code>");
    this.dom.error.classList.remove("util-hidden");
    this.dom.app.classList.add("util-hidden");
  }

  handleLoadError(e) {
    const fileName = new URLSearchParams(window.location.search).get("conf") || "tags.json";
    const isJsonError = e.message.includes("JSON");
    const errorTitle = isJsonError ? "Ошибка в формате JSON" : "Файл конфигурации не найден";
    const errorText = isJsonError
      ? `Файл **${fileName}** содержит ошибку формата: ${e.message}`
      : `Файл **${fileName}** не найден или недоступен.`;
    this.error(errorText, errorTitle);
  }
}

document.addEventListener("DOMContentLoaded", () => new TagsManager());