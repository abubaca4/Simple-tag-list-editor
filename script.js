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
    // Исходное значение устанавливается после загрузки конфига.
    this.displayMode = "text";
    this.imageTagCount = 0; // сколько кнопок имеют картинку
    this.isImageOnly = false; // true если в конфиге imageMode=imageOnly

    // Флаг для проверки наличия лимита
    this.hasCharacterLimit = false;

    // Переменные для поиска
    this.isSearchActive = false;
    this.searchResults = [];
    this.currentSearchIndex = 0;

    // Запускает главную последовательность инициализации
    this.initialize();
  }

  // Вспомогательная функция для работы с метаданными кеша в localStorage
  getCacheMetadata(fileName, action = "get", data = {}) {
    const key = `tagsManagerCacheMeta:${fileName}`;
    if (action === "get") {
      try {
        return JSON.parse(localStorage.getItem(key)) || {};
      } catch (e) {
        return {};
      }
    } else if (action === "set") {
      const currentData = this.getCacheMetadata(fileName);
      const newData = {
        cacheMaxAgeHours:
          data.cacheMaxAgeHours || currentData.cacheMaxAgeHours || 24,
        lastSuccessfulFetchTime: data.newContent
          ? Date.now()
          : currentData.lastSuccessfulFetchTime || 0,
      };
      localStorage.setItem(key, JSON.stringify(newData));
      return newData;
    }
    return {};
  }

  // Загружает конфигурационный файл, обрабатывая URL-параметры, кеширование и ошибки
  async startLoadingData() {
    const getParams = () => {
      const p = new URLSearchParams(window.location.search).get("conf");
      return p && !p.endsWith(".json") ? `${p}.json` : p || "tags.json";
    };

    this.configFileName = getParams();

    const fetchFile = async (f, fetchMode) => {
      const options = {
        cache: fetchMode, // 'default' (использует кеш, если свежий) или 'no-cache' (игнорирует кеш)
      };

      const r = await fetch(f, options);
      if (!r.ok) {
        // Если статус 404/500, возвращаем ошибку
        throw new Error(`Файл не найден (статус: ${r.status})`);
      }

      const json = await r.json();

      // Обновляем метаданные после успешного получения (статус 200)
      const cacheMaxAgeHours = json.cacheMaxAgeHours;
      this.getCacheMetadata(f, "set", { cacheMaxAgeHours, newContent: true });

      return json;
    };

    const fileName = getParams();
    let cacheMeta = this.getCacheMetadata(fileName);
    const now = Date.now();
    const lastFetchTime = cacheMeta.lastSuccessfulFetchTime || 0;

    // Расчет требуемого времени обновления
    const maxAgeHours = cacheMeta.cacheMaxAgeHours || 24; // По умолчанию 24 часа
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const isCacheExpired =
      lastFetchTime === 0 || now - lastFetchTime > maxAgeMs;

    // Определяем режим запроса
    // 'no-cache' заставит браузер обратиться к серверу (для проверки ETag/Last-Modified или получения нового файла).
    // 'default' позволит браузеру использовать кеш, если он свежий по заголовкам Cache-Control/Expires.
    const fetchMode = isCacheExpired ? "no-cache" : "default";

    try {
      return await fetchFile(fileName, fetchMode);
    } catch (e) {
      // Логика резервного варианта 'tags.json'
      if (fileName !== "tags.json") {
        try {
          // Пытаемся загрузить резервный 'tags.json' с принудительной проверкой,
          // чтобы убедиться, что он не устарел, если его будем использовать.
          return await fetchFile("tags.json", "no-cache");
        } catch (fallbackErr) {
          // Если оба файла не найдены/ошибочны, пробрасываем исходную ошибку
          throw e;
        }
      }
      // Пробрасываем ошибку, если исходный файл не 'tags.json' и не найден
      throw e;
    }
  }

  saveStateToStorage() {
    if (!this.configFileName) return;
    const key = `tagsManager_autosave:${this.configFileName}`;
    localStorage.setItem(key, this.dom.input.value);
  }

  loadStateFromStorage() {
    if (!this.configFileName) return null;
    const key = `tagsManager_autosave:${this.configFileName}`;
    return localStorage.getItem(key);
  }

  async initialize() {
    try {
      // Кэширует ссылки на все DOM-элементы
      this.cacheDOM();
      // Устанавливает обработчики для статичных элементов
      this.setupStaticEvents();

      // Ожидает завершения загрузки данных
      try {
        this.tagsData = await this.dataPromise;

        if (Array.isArray(this.tagsData.unrecognizedIgnore)) {
          this.unrecognizedIgnoreSet = new Set(
            this.tagsData.unrecognizedIgnore.map((t) => t.trim().toLowerCase()),
          );
        }

        // Проверяем наличие лимита символов в конфигурации
        this.hasCharacterLimit = this.tagsData?.characterLimit > 0;

        // Режим отображения тегов (textFirst, imageFirst, imageOnly)
        const mode = (this.tagsData.imageMode || "textFirst").toString();
        if (mode === "textFirst") {
          this.displayMode = "text";
        } else {
          this.displayMode = "image";
        }
        this.isImageOnly = mode === "imageOnly";

        // Скрываем input-section, если указано в конфигурации
        if (this.tagsData.hideInputSection) {
          this.dom.input.classList.add("util-hidden");
          if (this.dom.copyBtn) {
            this.dom.copyBtn.classList.add("util-hidden");
          }
        }

        this.initWebLinks();
      } catch (e) {
        this.handleLoadError(e);
        return;
      }

      // Настройка приложения после загрузки данных
      this.showUI();
      // Инициализирует внутренние структуры данных (Map'ы и индексы)
      this.initCategories();
      this.resolveRequiredTags();
      // Рендерит HTML-структуру тегов и навигации
      this.render();
      // сразу после рендера посмотрим, нужна ли кнопка переключения
      this.updateDisplayToggleVisibility();

      // 1. Пробуем загрузить сохраненное состояние
      const savedState = this.loadStateFromStorage();

      // 2. Если есть сохранение, используем его. Если нет, берем то, что в HTML (value="" у input)
      const initialValue = savedState?.trim() ? savedState : this.dom.input.value;

      if (initialValue) {
        this.parseInput(initialValue, true);
      }

      // Скрываем блок с лимитом, если он не задан
      if (!this.hasCharacterLimit) {
        this.dom.limitBox.parentElement.classList.add("util-hidden");
      } else {
        this.updateLimitDisplay(this.dom.input.value.length);
      }

      // Обновляет состояние всех кнопок и элементов
      this.updateFullState();
      this.updateAlt();
    } catch (e) {
      console.error(e);
      if (!this.dom.error.classList.contains("util-hidden")) return;
      this.error(
        `Критическая ошибка инициализации: ${e.message}`,
        "Критическая ошибка",
      );
    }
  }

  // Обрабатывает и отображает ошибки при загрузке конфигурационного файла
  handleLoadError(e) {
    const fileName =
      new URLSearchParams(window.location.search).get("conf") || "tags.json";
    const isJsonError = e.message.includes("JSON");
    const errorTitle = isJsonError
      ? "Ошибка в формате JSON"
      : "Файл конфигурации не найден";
    const errorText = isJsonError
      ? `Файл **${fileName}** содержит ошибку формата: ${e.message}`
      : `Файл **${fileName}** не найден или недоступен.`;
    this.error(errorText, errorTitle);
  }

  // Кэширует ссылки на все DOM-элементы по ID
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

  // Вспомогательная функция для создания DOM-элементов
  el(tag, cls = "", text = "", attrs = {}) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text) d.textContent = text;
    Object.entries(attrs).forEach(([k, v]) => d.setAttribute(k, v));
    return d;
  }

  // Инициализирует внутренние структуры данных из tagsData
  initCategories() {
    this.categories.clear();
    this.allTagsInOrder = [];
    this.tagIndexMap.clear();
    this.knownAsMap.clear();
    this.altTagSearchMap.clear();

    this.tagsData.categories.forEach((cat) => {
      const catData = {
        ...cat,
        requirement: cat.requirement || "none",
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

        // Если задано поле image, сохраняем путь.
        const imageUrl = t.image || null;

        names.forEach((name) => {
          catData.tags.set(name, {
            name,
            mainName: main,
            alternative: t.alternative || "",
            subgroup: t.subgroup || "",
            description: t.description || "",
            image: imageUrl,
            isVariant: name !== main,
            isMainTag: t.main || false,
            knownAs: t.knownAs || [],
            requiredTag: t.requiredTag || null,
          });

          // Индексация тегов для быстрого поиска
          const tagInfo = {
            name,
            mainName: main,
            category: cat.name,
            catData,
            tagConfig: t,
          };
          this.allTagsInOrder.push(tagInfo);
          const currentIndex = this.allTagsInOrder.length - 1;
          const lowerName = name.toLowerCase();

          if (!this.tagIndexMap.has(lowerName))
            this.tagIndexMap.set(lowerName, []);
          this.tagIndexMap.get(lowerName).push(currentIndex);

          if (Array.isArray(t?.knownAs)) {
            t.knownAs.forEach((alias) => {
              const cleanAlias = alias.trim().toLowerCase();
              if (!this.knownAsMap.has(cleanAlias))
                this.knownAsMap.set(cleanAlias, []);
              this.knownAsMap.get(cleanAlias).push(currentIndex);
            });
          }

          if (names.length === 1 && name.includes("/")) {
            this.generateAltNames(name).forEach((altName) => {
              const lowerAlt = altName.toLowerCase();
              if (!this.altTagSearchMap.has(lowerAlt))
                this.altTagSearchMap.set(lowerAlt, []);
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
        // Если в конфиге нет зависимостей, пропускаем
        if (!tag.requiredTag) return;

        // Приводим всё к массиву для единообразной обработки
        const rawRequirements = [tag.requiredTag].flat();

        tag.resolvedRequiredTags = [];

        rawRequirements.forEach((req) => {
          let targetCat = null;
          let targetTagName = "";

          if (typeof req === "string") {
            // Случай 1: Просто строка — ищем в текущей категории
            targetCat = catData;
            targetTagName = req;
          } else if (req?.category && req?.name) {
            // Случай 2: Объект — ищем в указанной категории
            targetCat = this.categories.get(req.category);
            targetTagName = req.name;
          }

          // Если категория существует и в ней есть такой тег — сохраняем "ссылку"
          if (targetCat?.tags.has(targetTagName)) {
            tag.resolvedRequiredTags.push({
              category: targetCat,
              tagName: targetTagName,
            });
          }
        });
      });
    });
  }

  initWebLinks() {
    const { webLinksNav } = this.dom;

    if (!webLinksNav) return;

    // Очищаем существующие ссылки
    webLinksNav.innerHTML = "";

    // Проверяем наличие webLinks в конфигурации
    if (Array.isArray(this.tagsData?.webLinks) && this.tagsData.webLinks.length > 0) {
      // 1. Получаем параметр linkbutton из URL и преобразуем его в массив имен
      const urlParams = new URLSearchParams(window.location.search);
      const linkButtonParam = urlParams.get("linkbutton");
      const allowedButtons = linkButtonParam
        ? linkButtonParam.split(",").map((s) => s.trim())
        : [];

      let addedLinksCount = 0;

      // 2. Фильтруем и создаем ссылки
      this.tagsData.webLinks.forEach((link) => {
        // Логика отображения:
        // - Если fName нет, отображаем всегда.
        // - Если fName есть, проверяем его наличие в параметрах запроса.
        const shouldDisplay =
          !link.fName || allowedButtons.includes(link.fName);

        if (shouldDisplay) {
          const target = link.target || "_blank";
          const linkAttrs = {
            href: link.url,
            target: target,
          };

          if (target === "_blank") {
            linkAttrs["rel"] = "noopener noreferrer";
          }

          const linkElement = this.el(
            "a",
            "web-link-item",
            link.name,
            linkAttrs,
          );
          webLinksNav.appendChild(linkElement);
          addedLinksCount++;
        }
      });

      // Показываем блок только если в итоге была добавлена хотя бы одна ссылка
      if (addedLinksCount > 0) {
        webLinksNav.classList.remove("util-hidden");
      } else {
        webLinksNav.classList.add("util-hidden");
      }
    } else {
      // Скрываем блок, если ссылок нет вообще
      webLinksNav.classList.add("util-hidden");
    }
  }

  // Генерирует альтернативные имена для тегов с косой чертой (например, "A/B C" -> "A C", "B C")
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

  // Устанавливает обработчики событий для основных элементов интерфейса
  setupStaticEvents() {
    const {
      input,
      limitBox,
      dupBox,
      pinBtn,
      main,
      header,
      container,
      themeToggleBtn,
      displayModeBtn,
      unrecWarn,
      refToggleBtn,
      refContent,
    } = this.dom;

    // Обработка ввода текста. Парсит входную строку и обновляет интерфейс
    input.addEventListener("input", () => {
      const newValue = input.value;
      const oldValue = this.loadStateFromStorage() || "";

      // Проверяем условие: старая строка является частью новой, 
      // а разница состоит только из пробелов и/или запятых.
      let shouldSkipParsing = false;
      if (newValue.startsWith(oldValue)) {
        const diff = newValue.substring(oldValue.length);
        // Регулярное выражение проверяет, что в "хвосте" только запятые и пробельные символы
        if (/^[,\s]+$/.test(diff)) {
          shouldSkipParsing = true;
        }
      }

      if (!shouldSkipParsing) {
        unrecWarn.classList.add("util-hidden");
        this.parseInput(newValue, true);
        this.updateUI(false);
        this.saveStateToStorage();
      }
    });

    // Обработка клика по кнопке копирования
    this.dom.copyBtn.addEventListener("click", async () => {
      try {
        if (!(this.dom.input.value.replace(/\s+/g, "") == "")) {
          await navigator.clipboard.writeText(this.dom.input.value);

          // Проверяем, виден ли блок с альтернативными тегами
          if (!this.dom.altSection.classList.contains("util-hidden")) {
            // Вычисляем отступ с учетом закрепленного хедера
            const offset = this.isHeaderPinned ? this.dom.header.offsetHeight + 30 : 20;
            const top = this.dom.altSection.getBoundingClientRect().top + window.scrollY - offset;

            // Плавно прокручиваем к блоку
            window.scrollTo({ top, behavior: "smooth" });
          }
        }
      } catch (err) {
        console.error("Ошибка при копировании: ", err);
      }
    });

    // Обработка клика по кнопке очистки
    this.dom.clearBtn.addEventListener("click", () => {
      this.dom.input.value = "";
      this.dom.input.focus();
      unrecWarn.classList.add("util-hidden");
      this.parseInput("", true);
      this.updateUI(false);
      this.saveStateToStorage();
    });

    // Обработка клика по кнопке копирования альтернативных тегов
    this.dom.copyAltBtn.addEventListener("click", async () => {
      try {
        if (!(this.dom.altOut.value.replace(/\s+/g, "") == "")) {
          await navigator.clipboard.writeText(this.dom.altOut.value);
        }
      } catch (err) {
        console.error("Ошибка при копировании альтернативных тегов: ", err);
      }
    });

    // Обработка чекбоксов лимита и дубликатов
    limitBox.addEventListener("change", () => {
      this.updateUI(true);
    });
    dupBox.addEventListener("change", () => this.updateAlt());

    // Переключение раздела справки
    refToggleBtn.addEventListener("click", () => {
      const isHidden = refContent.classList.toggle("util-hidden");
      refToggleBtn.textContent = isHidden ? "Важная информация" : "Скрыть";
      if (this.isHeaderPinned) this.updateHeaderOffset();
    });

    // Делегирование клика по кнопкам тегов
    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".tag-button");
      if (!btn) return;
      const catName = btn
        .closest(".category")
        .querySelector(".category-title").textContent;

      let tagName;
      if (e.target.tagName === "IMG" && btn.dataset.mainname) {
        // при клике на картинку используем основное имя (первый вариант)
        tagName = btn.dataset.mainname;
      } else {
        tagName = btn.dataset.name || btn.textContent;
      }

      this.handleTagClick(catName, tagName);
    });

    // Переключение состояния закрепления хедера
    pinBtn.addEventListener("click", () => {
      this.isHeaderPinned = !this.isHeaderPinned;
      this.updatePinState();
      localStorage.setItem("headerPinned", this.isHeaderPinned);
    });

    const savedPinned = localStorage.getItem("headerPinned");
    this.isHeaderPinned = savedPinned !== null ? JSON.parse(savedPinned) : true;

    // Переключение режима отображения тегов
    if (displayModeBtn) {
      displayModeBtn.addEventListener("click", () => this.toggleTagDisplayMode());
    }

    // Переключение темы
    themeToggleBtn.addEventListener("click", () => this.toggleTheme());
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme) {
      this.themeState = savedTheme;
      this.applyTheme();
    }

    // СОБЫТИЯ ПОИСКА
    if (this.dom.searchToggleBtn) {
      this.dom.searchToggleBtn.addEventListener("click", () => this.toggleSearchMode());
      this.dom.searchInput.addEventListener("input", () => this.performSearch());
      this.dom.searchPrevBtn.addEventListener("click", () => this.navigateSearch(-1));
      this.dom.searchNextBtn.addEventListener("click", () => this.navigateSearch(1));

      this.dom.searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "ArrowDown") {
          e.preventDefault(); // Чтобы курсор не прыгал в конец/начало строки
          this.navigateSearch(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          this.navigateSearch(-1);
        }
      });
    }

    // Оптимизированные обработчики скролла и изменения размера окна
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

    // Обработка нажатия мыши вне основных контейнеров (для скролла наверх)
    document.body.addEventListener("mousedown", (e) => {
      if (
        !main.contains(e.target) &&
        !header.contains(e.target) &&
        !e.target.closest(".scroll-hint")
      ) {
        if (window.scrollY > 300)
          window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    // Обработка клика по подсказкам скролла
    this.dom.scrollHints.forEach((h) =>
      h.addEventListener("click", () =>
        window.scrollTo({ top: 0, behavior: "smooth" }),
      ),
    );
  }

  // Генерирует HTML-структуру категорий и кнопок тегов
  render() {
    // при каждом рендере пересчитываем сколько кнопок имеют картинки
    this.imageTagCount = 0;
    const { container, navList, refSection, refContent, refToggleBtn } =
      this.dom;

    // Очистка контейнеров
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

    // Создание DocumentFragment для категорий
    const categoriesFragment = document.createDocumentFragment();

    // Создание DocumentFragment для навигации
    const navFragment = document.createDocumentFragment();

    this.categories.forEach((catData, catName) => {
      // Создание DOM-элемента категории
      const catDiv = this.el("div", "category");
      catData.dom = catDiv; // Сохранение ссылки на DOM-элемент категории

      const titleRow = this.el("div", "category-title-container");
      const left = this.el("div", "category-title-left");
      left.append(this.el("div", "category-title", catName));
      if (catData.description) {
        left.append(
          this.el("button", "category-help-button", "?", {
            "data-tooltip": catData.description,
          }),
        );
      }

      let refContent = null;
      if (catData.reference) {
        const refButton = this.el(
          "button",
          "util-tag-base pin-header-button",
          "Справка",
        );
        left.append(refButton);

        refContent = this.el("div", "reference-content util-hidden", "");
        refContent.innerHTML = catData.reference;

        refButton.onclick = () => {
          const isHidden = refContent.classList.toggle("util-hidden");
          refButton.textContent = isHidden ? "Справка" : "Скрыть";
          if (this.isHeaderPinned) this.updateHeaderOffset();
        };
      }

      const scrollTop = this.el("button", "category-scroll-top", "˄", {
        "aria-label": "Наверх",
      });
      scrollTop.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });

      titleRow.append(left, scrollTop);
      const warnEl = this.el("div", "category-warning util-hidden");
      catData.warnDom = warnEl;
      catDiv.append(titleRow);
      if (refContent) catDiv.append(refContent);
      catDiv.append(warnEl);

      const subgroups = this.groupTags(catData);
      subgroups.forEach((tags, subName) => {
        const subDiv = this.el("div", "subgroup");
        if (subName && !subName.startsWith("!")) {
          subDiv.append(this.el("div", "subgroup-title", subName));
        }

        const groupDiv = this.el("div", "tags-group");
        tags.forEach((item) => {
          if (item.type === "variant") {
            const vGroup = this.el("div", "variant-group");
            const vBtns = this.el("div", "variant-buttons");
            item.variants.forEach((t) => vBtns.append(this.createBtn(t)));
            vGroup.append(vBtns);
            if (item.desc)
              vGroup.append(this.el("div", "variant-description", item.desc));
            groupDiv.append(vGroup);
          } else {
            groupDiv.append(this.createBtn(item.tag));
          }
        });
        subDiv.append(groupDiv);
        catDiv.append(subDiv);
      });

      // Добавление категории во фрагмент
      categoriesFragment.appendChild(catDiv);

      // Создание элемента навигации
      const navItem = this.el("button", "category-nav-item", catName);
      navItem.onclick = () => this.scrollToCat(catName);
      catData.navBtn = navItem;
      navFragment.appendChild(navItem);
    });

    // Одноразовое добавление всех категорий и элементов навигации
    container.appendChild(categoriesFragment);
    navList.appendChild(navFragment);

    this.updateNavVis();
    this.updatePinState();
  }

  // Создает кнопку тега с заданными параметрами
  createBtn(tag) {
    // элемент само по себе остаётся <button>, но внутри у нас два
    // блока: span.tag-text и (если задано) img.tag-image.
    let cssClass = `tag-button util-tag-base${tag.isMainTag ? " main-tag" : ""}`;
    if (tag.image) cssClass += " has-image";

    const btn = this.el("button", cssClass, "", {
      "data-tooltip": tag.description || "",
      "data-name": tag.name,
      "data-mainname": tag.mainName || tag.name,
    });

    // текстовая часть
    const textSpan = document.createElement("span");
    textSpan.className = "tag-text";
    textSpan.textContent = tag.name;
    btn.appendChild(textSpan);

    // графика, если есть
    if (tag.image) {
      const img = document.createElement("img");
      img.className = "tag-image";
      img.src = tag.image;
      img.alt = tag.name;
      btn.appendChild(img);

      // увеличиваем счётчик, чтобы потом решить показывать переключатель
      this.imageTagCount += 1;

      // начальная видимость в зависимости от режима
      if (this.displayMode === "text") {
        img.classList.add("util-hidden");
      } else {
        textSpan.classList.add("util-hidden");
      }
    }

    if (!tag.domButtons) {
      tag.domButtons = [];
    }
    tag.domButtons.push(btn);

    return btn;
  }

  // Переключает и сохраняет состояние темы (Авто/Темная/Светлая)
  toggleTheme() {
    const states = ["auto", "dark", "light"];
    this.themeState =
      states[(states.indexOf(this.themeState) + 1) % states.length];
    this.applyTheme();
    localStorage.setItem("theme", this.themeState);
  }

  // Применяет выбранную тему к элементу <html> и обновляет иконки
  applyTheme() {
    const html = document.documentElement;
    this.themeState === "auto"
      ? html.removeAttribute("data-theme")
      : html.setAttribute("data-theme", this.themeState);
    this.dom.themeIcon.textContent = this.themeIcons[this.themeState];
    this.dom.themeText.textContent = this.themeTexts[this.themeState];
    this.dom.themeToggleBtn.title = `Тема: ${this.themeTexts[this.themeState]}`;
  }

  // Показывает или прячет кнопку переключения режима и устанавливает иконку
  updateDisplayToggleVisibility() {
    const btn = this.dom.displayModeBtn;
    if (!btn) return;
    if (this.isImageOnly || this.imageTagCount === 0) {
      btn.classList.add("util-hidden");
      return;
    }
    btn.classList.remove("util-hidden");
    this.updateDisplayToggleIcon();
  }

  updateDisplayToggleIcon() {
    const { displayModeBtn, displayIcon, displayText } = this.dom;
    if (!displayModeBtn) return;
    const showingText = this.displayMode === "text";
    displayIcon.textContent = showingText ? "🔤" : "🖼️";
    displayText.textContent = showingText ? "Текст" : "Иконки";
    displayModeBtn.title = showingText ? "Показать изображения" : "Показать текст";
  }

  // Переключает режим текста/изображений у всех кнопок
  toggleTagDisplayMode() {
    const headerHeight = this.isHeaderPinned ? this.dom.header.offsetHeight : 0;

    const findFirstVisibleButton = () => {
      const buttons = this.dom.container.querySelectorAll(".tag-button");
      const viewportTop = headerHeight;
      for (const btn of buttons) {
        const rect = btn.getBoundingClientRect();
        if (rect.bottom > viewportTop && rect.top < window.innerHeight) {
          return btn;
        }
      }
      return null;
    };

    const firstVisibleButton = findFirstVisibleButton();
    const desiredOffset = firstVisibleButton
      ? Math.max(headerHeight + 8, firstVisibleButton.getBoundingClientRect().top)
      : headerHeight + 8;

    this.displayMode = this.displayMode === "text" ? "image" : "text";
    this.updateDisplayToggleIcon();

    // обновляем у каждой кнопки с картинкой
    this.categories.forEach((cat) => {
      cat.tags.forEach((tag) => {
        if (tag.image && tag.domButtons) {
          tag.domButtons.forEach((btn) => {
            const textElem = btn.querySelector(".tag-text");
            const imgElem = btn.querySelector(".tag-image");
            if (textElem && imgElem) {
              if (this.displayMode === "text") {
                textElem.classList.remove("util-hidden");
                imgElem.classList.add("util-hidden");
              } else {
                textElem.classList.add("util-hidden");
                imgElem.classList.remove("util-hidden");
              }
            }
          });
        }
      });
    });

    requestAnimationFrame(() => {
      if (firstVisibleButton && firstVisibleButton.isConnected) {
        const buttonTop = firstVisibleButton.getBoundingClientRect().top + window.scrollY;
        const targetScroll = Math.max(0, buttonTop - desiredOffset);
        window.scrollTo({ top: targetScroll, behavior: "auto" });
      }

      this.updateNavVis();
      this.updateScrollHints();
      if (this.isHeaderPinned) this.updateHeaderOffset();
    });
  }

  // Группирует теги в подгруппы для рендеринга
  groupTags(catData) {
    const subs = new Map();
    const processed = new Set();

    // Инициализация domButtons для всех тегов
    catData.tags.forEach((tag) => {
      tag.domButtons = [];
    });

    catData.variantGroups.forEach((vars, main) => {
      const tag = catData.tags.get(vars[0]);
      if (!tag) return;
      const s = tag.subgroup || "";
      if (!subs.has(s)) subs.set(s, []);
      subs.get(s).push({
        type: "variant",
        variants: vars.map((v) => catData.tags.get(v)),
        desc: tag.description,
      });
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

  // Обрабатывает клик по кнопке тега
  handleTagClick(catName, tagName) {
    const cat = this.categories.get(catName);
    const tag = cat.tags.get(tagName);
    const main = tag.mainName;

    // Создает снэпшот состояния для возможности отката
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

    // Применяет логику выбора (single, ordered, multiple)
    if (cat.type === "single") {
      const isActive = cat.selectedTags.has(main);
      cat.selectedTags.forEach((m) => {
        this.selectedTags.delete(m);
      });
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
      cat.orderedTags.sort((a, b) => {
        const isAm = cat.tags.get(a).isMainTag,
          isBm = cat.tags.get(b).isMainTag;
        return isAm === isBm ? 0 : isAm ? -1 : 1;
      });
    } else {
      const curVar = cat.selectedVariants.get(main);
      if (cat.selectedTags.has(main) && curVar === tagName) delSel();
      else setSel(tagName);
    }

    // Если тег сейчас выбран и у него есть требование другого тега
    if (cat.selectedTags.has(main) && tag.resolvedRequiredTags) {
      this.processRequiredTag(tag.resolvedRequiredTags);
    }

    // ПРЕДВАРИТЕЛЬНАЯ ПРОВЕРКА ЛИМИТА СИМВОЛОВ - только если лимит задан
    if (this.hasCharacterLimit) {
      const newStr = this.generateOutputString();
      const limit = this.tagsData.characterLimit;
      const isLim = this.dom.limitBox.checked;

      if (isLim && newStr.length > limit) {
        // Откат состояния, если лимит превышен
        cat.selectedTags.forEach((m) => this.selectedTags.delete(m));

        cat.selectedTags = snapshot.selectedTags;
        cat.orderedTags = snapshot.orderedTags;
        cat.selectedVariants = snapshot.selectedVariants;

        // Восстановление глобальных ссылок
        cat.selectedTags.forEach((m) => this.selectedTags.set(m, catName));

        // Визуальное уведомление об ошибке
        this.flashLimitError();
        return;
      }
    }

    // Обновление интерфейса
    const newStr = this.generateOutputString();
    this.dom.input.value = newStr;
    this.saveStateToStorage();
    this.updateLimitDisplay(newStr.length);
    this.updateCategoryDOM(cat); // Обновление только одной категории
    this.updateAlt();
  }

  // Обрабатывает логику обязательного связанного тега
  processRequiredTag(resolvedTags) {
    resolvedTags.forEach(({ category, tagName }) => {
      const targetTag = category.tags.get(tagName);
      const targetMain = targetTag.mainName;

      // Если тег уже выбран (в любом варианте), ничего не делаем
      if (category.selectedTags.has(targetMain)) return;

      // Активируем тег
      category.selectedTags.add(targetMain);
      this.selectedTags.set(targetMain, category.name);
      category.selectedVariants.set(targetMain, tagName);

      if (category.type === "ordered") {
        category.orderedTags.push(targetMain);
        category.orderedTags.sort((a, b) => {
          const isAm = category.tags.get(a).isMainTag,
            isBm = category.tags.get(b).isMainTag;
          return isAm === isBm ? 0 : isAm ? -1 : 1;
        });
      }

      // Обновляем визуальное состояние категории, в которой находится активированный тег
      this.updateCategoryDOM(category);
    });
  }

  // Парсит входную строку из поля ввода, обновляя внутреннее состояние
  parseInput(str, updateInputValue = true) {
    // Очистка предыдущего состояния
    this.selectedTags.clear();
    this.categories.forEach((c) => {
      c.selectedTags.clear();
      c.orderedTags = [];
      c.selectedVariants.clear();
    });
    this.unrecognizedTags = [];

    const rawTags = str
      .split(this.tagsData.separator)
      .map((t) => t.trim())
      .filter(Boolean);

    const recognizedIndices = new Set();

    // Поиск тегов по прямому имени, алиасу или альтернативному имени
    const findTagInMaps = (term) => {
      const maps = [this.tagIndexMap, this.knownAsMap, this.altTagSearchMap];
      for (const map of maps) {
        if (map.has(term)) {
          return map.get(term);
        }
      }
      return null; // Возвращаем null, если ничего не найдено
    };

    rawTags.forEach((tNameOriginal, tagIndex) => {
      const tName = tNameOriginal.toLowerCase();
      const foundIndicesArray = findTagInMaps(tName);

      if (foundIndicesArray !== null) {
        // Проходим по всем найденным индексам, активируя сразу все привязанные теги
        foundIndicesArray.forEach((foundIndex) => {
          const info = this.allTagsInOrder[foundIndex];
          const cat = info.catData;
          const main = info.mainName;

          if (cat.type === "single") {
            cat.selectedTags.forEach((m) => this.selectedTags.delete(m));
            cat.selectedTags.clear();
            cat.selectedTags.add(main);
          } else {
            if (!cat.selectedTags.has(main)) cat.selectedTags.add(main);
            if (cat.type === "ordered" && !cat.orderedTags.includes(main))
              cat.orderedTags.push(main);
          }

          cat.selectedVariants.set(main, info.name);
          this.selectedTags.set(main, info.category);
        });

        // Отмечаем токен как распознанный (один раз для всех сработавших тегов)
        recognizedIndices.add(tagIndex);
      }
    });

    this.unrecognizedTags = rawTags.filter(
      (tagStr, index) =>
        !recognizedIndices.has(index) &&
        !this.unrecognizedIgnoreSet.has(tagStr.toLowerCase()),
    );

    // Перезаписывает поле ввода форматированной строкой
    if (updateInputValue) {
      this.dom.input.value = this.generateOutputString();
    }
  }

  // Генерирует итоговую строку тегов из внутреннего состояния
  generateOutputString() {
    const res = [];
    this.processSelectedTags((name) => res.push(name));
    return res.join(this.tagsData.separator);
  }

  // Итератор по выбранным тегам с учетом порядка и типа категории
  processSelectedTags(callback) {
    // Порядок категорий берется из конфигурации
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

  // Обновляет весь пользовательский интерфейс (поле ввода, кнопки, предупреждения)
  updateUI(updateInputFromState = true) {
    if (updateInputFromState) {
      const str = this.generateOutputString();
      this.dom.input.value = str;
    }

    const len = this.dom.input.value.length;
    this.updateLimitDisplay(len);

    const { unrecWarn } = this.dom;
    if (this.unrecognizedTags.length > 0) {
      unrecWarn.textContent = `Не распознано: ${this.unrecognizedTags.join(", ")}`;
      unrecWarn.classList.remove("util-hidden");
    } else {
      unrecWarn.classList.add("util-hidden");
    }

    this.updateFullState(); // Обновляет все кнопки
    this.updateAlt();
  }

  // Обновляет индикатор лимита символов
  updateLimitDisplay(len) {
    // Если лимит не задан, не обновляем отображение
    if (!this.hasCharacterLimit) return;

    const limit = this.tagsData.characterLimit;
    const isLim = this.dom.limitBox.checked;
    this.dom.limitDisp.textContent = `${len}/${limit}`;
    this.dom.limitDisp.classList.toggle("exceeded", isLim && len > limit);
  }

  // Визуально сигнализирует о превышении лимита символов
  flashLimitError() {
    // Если лимит не задан, не показываем ошибку
    if (!this.hasCharacterLimit) return;

    this.dom.limitDisp.classList.add("exceeded");
    const originalText = this.dom.limitDisp.textContent;
    this.dom.limitDisp.textContent = "ЛИМИТ!";
    setTimeout(() => {
      this.dom.limitDisp.textContent = originalText;
      const len = this.dom.input.value.length;
      const limit = this.tagsData.characterLimit;
      this.dom.limitDisp.classList.toggle(
        "exceeded",
        this.dom.limitBox.checked && len > limit,
      );
    }, 800);
  }

  // Обновляет визуальное состояние кнопок только для одной категории
  updateCategoryDOM(cat) {
    if (!cat.dom) return;
    this.updateButtonsInContainer(cat.dom, cat);
    this.refreshGlobalWarning();
  }

  // Обновляет все кнопки во всех категориях
  updateFullState() {
    this.categories.forEach((cat) => {
      if (cat.dom) this.updateButtonsInContainer(cat.dom, cat);
    });
    this.refreshGlobalWarning();
    // кнопка переключения показана/скрыта при общем обновлении
    this.updateDisplayToggleVisibility();
  }

  // Основная функция для обновления классов кнопок и предупреждений внутри контейнера категории
  updateButtonsInContainer(container, cat) {
    // Более эффективный подход - использование сохранённых ссылок на кнопки
    cat.tags.forEach((tag) => {
      if (tag.domButtons && tag.domButtons.length > 0) {
        tag.domButtons.forEach((btn) => {
          const tName = tag.name; // Используем имя из объекта тега
          const sel =
            cat.selectedTags.has(tag.mainName) &&
            cat.selectedVariants.get(tag.mainName) === tName;

          // Установка класса 'selected'
          if (btn.classList.contains("selected") !== sel) {
            btn.classList.toggle("selected", sel);
          }

          // Установка порядка для ordered-категорий
          if (cat.type === "ordered") {
            if (sel) {
              const order = cat.orderedTags.indexOf(tag.mainName) + 1;
              if (btn.getAttribute("data-order") != order) {
                btn.classList.add("ordered");
                btn.setAttribute("data-order", order);
              }
            } else {
              if (btn.classList.contains("ordered")) {
                btn.classList.remove("ordered");
                btn.removeAttribute("data-order");
              }
            }
          } else {
            if (btn.classList.contains("ordered")) {
              btn.classList.remove("ordered");
              btn.removeAttribute("data-order");
            }
          }
        });
      }
    });

    // Логика предупреждений о требованиях категории
    const warn = cat.warnDom;
    let showWarn = false;
    let txt = "";

    if (cat.requirement === "atLeastOne") {
      showWarn = cat.selectedTags.size === 0;
      txt =
        cat.overrideRequirementText || "Необходимо выбрать хотя бы один тег";
    } else if (cat.requirement === "atLeastOneMain") {
      showWarn = ![...cat.selectedTags].some((m) => cat.tags.get(m).isMainTag);
      txt =
        cat.overrideRequirementText ||
        "Необходимо выбрать хотя бы один главный тег";
    }

    if (warn.textContent !== txt) warn.textContent = txt;
    warn.classList.toggle("util-hidden", !showWarn);
    if (cat.navBtn) {
      cat.navBtn.classList.toggle("nav-item-error", showWarn);
    }
    cat.hasError = showWarn;
    return showWarn;
  }

  // Генерирует и отображает строку альтернативных тегов
  updateAlt() {
    const alts = [];
    const seen = new Set();
    let hasDuplicates = false;

    // Сначала собираем все альтернативы и проверяем на дубликаты
    this.processSelectedTags((_, tagObj) => {
      if (tagObj.alternative) {
        const norm = tagObj.alternative
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
        alts.push(tagObj.alternative);
        if (seen.has(norm)) {
          hasDuplicates = true;
        }
        seen.add(norm);
      }
    });

    // Показываем или скрываем checkbox в зависимости от наличия дубликатов
    const dupControls = this.dom.dupBox.closest('.alternative-controls');
    if (hasDuplicates) {
      dupControls.classList.remove('util-hidden');
    } else {
      dupControls.classList.add('util-hidden');
      this.dom.dupBox.checked = false; // Сбрасываем чекбокс если скрываем
    }

    // Теперь фильтруем дубликаты если чекбокс отмечен
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

    // ВСЕГДА обновляем видимость секции в зависимости от наличия текста
    const shouldBeVisible = s.length > 0;

    // Проверяем, нужно ли изменить видимость
    if (
      shouldBeVisible !== !this.dom.altSection.classList.contains("util-hidden")
    ) {
      this.dom.altSection.classList.toggle("util-hidden", !shouldBeVisible);
    }

    // Обновляем значение только если оно изменилось
    if (this.dom.altOut.value !== s) {
      this.dom.altOut.value = s;
    }

    // Обновляем alternativeName
    if (this.tagsData.alternativeName && shouldBeVisible) {
      this.dom.altName.textContent = this.tagsData.alternativeName;
      this.dom.altName.classList.remove('util-hidden');
    } else {
      this.dom.altName.classList.add('util-hidden');
    }

    // Обновление смещения хедера при изменении видимости секции
    if (shouldBeVisible && this.isHeaderPinned) {
      if (!this.scrollTicking) {
        window.requestAnimationFrame(() => this.updateHeaderOffset());
      }
    }
  }

  // Плавно прокручивает страницу до указанной категории
  scrollToCat(name) {
    const el = this.categories.get(name)?.dom;
    if (!el) return;
    const offset = this.isHeaderPinned ? this.dom.header.offsetHeight + 30 : 20;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  }

  // Устанавливает отступ для основного контента, учитывая высоту закрепленного хедера
  updateHeaderOffset() {
    if (!this.isHeaderPinned) {
      this.dom.main.style.paddingTop = "";
      return;
    }
    const h = this.dom.header.offsetHeight;
    const target = `${h + 55}px`;
    if (this.dom.main.style.paddingTop !== target) {
      this.dom.main.style.paddingTop = target;
    }
  }

  // Обновляет визуальное состояние кнопки закрепления и самого хедера
  updatePinState() {
    const { pinBtn, header, main, pinText } = this.dom;
    const act = this.isHeaderPinned;
    pinBtn.classList.toggle("active", act);
    header.classList.toggle("pinned", act);
    main.classList.toggle("has-pinned-header", act);
    pinText.textContent = act ? "Закреплено" : "Закрепить";
    this.updateNavVis();
    this.updateScrollHints();
    this.updateHeaderOffset();
  }

  // Показывает/скрывает навигацию по категориям в зависимости от необходимости
  updateNavVis() {
    const need =
      this.dom.main.scrollHeight > window.innerHeight || this.isHeaderPinned;
    this.dom.nav.classList.toggle("util-hidden", !need);
  }

  // Показывает/скрывает подсказки скролла наверх
  updateScrollHints() {
    const vis =
      window.innerWidth > this.dom.main.offsetWidth + 200 &&
      window.scrollY > 100;
    this.dom.scrollHints.forEach((h) => h.classList.toggle("visible", vis));
  }

  refreshGlobalWarning() {
    const hasAnyError = [...this.categories.values()].some(
      (cat) => cat.hasError,
    );

    const isHidden = this.dom.globalCatWarn.classList.contains("util-hidden");

    // Показываем/скрываем блок
    this.dom.globalCatWarn.classList.toggle("util-hidden", !hasAnyError);

    // Если видимость изменилась и хедер закреплен, обновляем отступ контента
    if (isHidden !== !hasAnyError && this.isHeaderPinned) {
      this.updateHeaderOffset();
    }
  }

  // Показывает основной интерфейс приложения
  showUI() {
    this.dom.loading.classList.add("util-hidden");
    this.dom.error.classList.add("util-hidden");
    this.dom.app.classList.remove("util-hidden");
  }

  // Отображает сообщение об ошибке
  error(detailText, title = "Ошибка загрузки конфигурации") {
    this.dom.loading.classList.add("util-hidden");
    this.dom.errTitle.textContent = title;
    this.dom.errDetail.innerHTML = detailText.replace(
      /\*\*(.*?)\*\*/g,
      "<code>$1</code>",
    );
    this.dom.error.classList.remove("util-hidden");
    this.dom.app.classList.add("util-hidden");
  }

  // Включает/выключает режим поиска
  toggleSearchMode() {
    this.isSearchActive = !this.isSearchActive;

    // Переключаем визуальное состояние кнопки (зеленая рамка/фон)
    this.dom.searchToggleBtn.classList.toggle("active", this.isSearchActive);

    // Переключаем видимость полей
    this.dom.mainInputWrap.classList.toggle("util-hidden", this.isSearchActive);
    this.dom.searchInputWrap.classList.toggle("util-hidden", !this.isSearchActive);

    if (!this.isSearchActive) {
      // При выходе из поиска сбрасываем всё
      this.clearSearch();
    } else {
      // При входе фокусируемся на поле и запускаем поиск (вдруг там остался текст)
      this.dom.searchInput.focus();
      this.performSearch();
    }
  }

  // Очищает поиск и снимает выделения
  clearSearch() {
    this.dom.searchInput.value = "";
    this.searchResults = [];
    this.currentSearchIndex = 0;
    this.dom.searchInput.classList.remove("search-error-pulse");
    this.updateSearchHighlight();
  }

  // Ищет теги по полю description
  performSearch() {
    const query = this.dom.searchInput.value.trim().toLowerCase();
    this.searchResults = [];
    this.currentSearchIndex = 0;

    if (!query) {
      this.clearSearch();
      return;
    }

    // Проходим по всем категориям и тегам
    this.categories.forEach((cat) => {
      cat.tags.forEach((tag) => {
        // Проверяем наличие описания и вхождение искомой строки
        if ([tag.name].flat().some(name => name.toLowerCase().includes(query)) ||
          tag.description?.toLowerCase().includes(query)) {
          // Если у тега есть сгенерированная DOM-кнопка (берем первую)
          if (tag.domButtons?.length > 0) {
            this.searchResults.push(tag.domButtons[0]);
          }
        }
      });
    });

    if (this.searchResults.length === 0) {
      this.dom.searchInput.classList.add("search-error-pulse");
    } else {
      this.dom.searchInput.classList.remove("search-error-pulse");
    }

    this.updateSearchHighlight();
  }

  // Переключение между результатами
  navigateSearch(direction) {
    if (this.searchResults.length === 0) return;

    this.currentSearchIndex += direction;

    // Ограничиваем индекс
    if (this.currentSearchIndex < 0) {
      this.currentSearchIndex = 0;
    }
    if (this.currentSearchIndex >= this.searchResults.length) {
      this.currentSearchIndex = this.searchResults.length - 1;
    }

    this.updateSearchHighlight();
  }

  // Обновляет визуальное выделение и прокручивает к результату
  updateSearchHighlight() {
    // 1. Снимаем выделение со всех тегов
    document.querySelectorAll(".search-match-active").forEach(btn => {
      btn.classList.remove("search-match-active");
    });

    const total = this.searchResults.length;

    // 2. Если ничего не найдено, прячем кнопки-стрелки
    if (total === 0) {
      this.dom.searchPrevBtn.disabled = true;
      this.dom.searchNextBtn.disabled = true;
      return;
    }

    // 3. Выделяем текущий элемент
    const activeBtn = this.searchResults[this.currentSearchIndex];
    if (activeBtn) {
      activeBtn.classList.add("search-match-active");

      // 4. Плавно прокручиваем к нему с учетом закрепленного хедера
      const headerHeight = this.dom.header && this.isHeaderPinned ? this.dom.header.offsetHeight : 0;
      const offset = headerHeight + 30; // 30px отступ сверху
      const top = activeBtn.getBoundingClientRect().top + window.scrollY - offset;

      window.scrollTo({ top, behavior: "smooth" });
    }

    // 5. Активируем/деактивируем стрелки в зависимости от границ
    this.dom.searchPrevBtn.disabled = this.currentSearchIndex === 0;
    this.dom.searchNextBtn.disabled = this.currentSearchIndex === total - 1;
  }
}

// Инициализация при полной загрузке DOM
document.addEventListener("DOMContentLoaded", () => new TagsManager());
