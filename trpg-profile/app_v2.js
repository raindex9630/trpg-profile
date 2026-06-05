document.addEventListener('DOMContentLoaded', () => {
    // スマホナビゲーションの初期位置を左端に
    const nav = document.querySelector('.site-header nav');
    const navUl = nav ? nav.querySelector('ul') : null;
    if (navUl) {
        // 最初は常に.no-scrollbarを付与（自動復元時は絶対に表示されない）
        navUl.classList.add('no-scrollbar');
        // localStorageから保存位置を取得
        const savedScroll = localStorage.getItem('navScrollLeft');
        if (savedScroll !== null) {
            navUl.scrollLeft = parseInt(savedScroll, 10);
            setTimeout(() => {
                requestAnimationFrame(() => {
                    navUl.scrollLeft = parseInt(savedScroll, 10);
                    requestAnimationFrame(() => {
                        navUl.scrollLeft = parseInt(savedScroll, 10);
                    });
                });
            }, 300);
        }
        // 実際に横スクロールしたときのみ.no-scrollbarを外す
        let lastScrollLeft = navUl.scrollLeft;
        let hideScrollbarTimer = null;
        const hideScrollbar = () => {
            navUl.classList.add('no-scrollbar');
        };
        const showScrollbar = () => {
            navUl.classList.remove('no-scrollbar');
            if (hideScrollbarTimer) clearTimeout(hideScrollbarTimer);
            hideScrollbarTimer = setTimeout(() => {
                // スクロール位置が変化していなければ非表示に戻す
                if (navUl.scrollLeft === lastScrollLeft) {
                    hideScrollbar();
                }
            }, 1000);
        };
        navUl.addEventListener('scroll', () => {
            localStorage.setItem('navScrollLeft', navUl.scrollLeft);
            if (Math.abs(navUl.scrollLeft - lastScrollLeft) > 0) {
                showScrollbar();
            }
            lastScrollLeft = navUl.scrollLeft;
        });
        navUl.addEventListener('wheel', showScrollbar, { passive: true });
        navUl.addEventListener('touchmove', showScrollbar, { passive: true });
    }
    const app = document.getElementById('app');
    const loading = document.getElementById('loading');
    const navLinks = document.querySelectorAll('.nav-link');
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    const modalCaption = document.getElementById('modal-caption');
    const modalCounter = document.getElementById('modal-counter');
    const modalPrev = document.getElementById('modal-prev');
    const modalNext = document.getElementById('modal-next');
    const closeModal = document.querySelector('.close-modal');

    // スライドショーのステート
    let _slidePages = [];
    let _slideIndex = 0;

    // true にすると「他ジャンル」欄を表示
    const SHOW_OTHER_GENRES = false;

    let data = {
        profile: null,
        likes: null,
        scenarios: null,
        pcs: null,
        works: null
    };

    // Generate placeholder image
    function generatePlaceholderImage(text, width = 200, height = 200) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // 灰色背景
        ctx.fillStyle = '#c8c8c8';
        ctx.fillRect(0, 0, width, height);

        // テキスト
        ctx.fillStyle = '#646464';
        ctx.font = `${Math.floor(width * 0.2)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, width / 2, height / 2);

        return canvas.toDataURL();
    }

    // Initialize
    init();

    async function init() {
        try {
            await fetchData();
            window.addEventListener('hashchange', handleRoute);
            handleRoute(); // Initial load
        } catch (error) {
            console.error('Data load failed:', error);
            app.innerHTML = '<p class="error">データの読み込みに失敗しました。</p>';
        }
    }

    async function fetchData() {
        const ts = new Date().getTime();
        const [profileRes, likesRes, scenariosRes, pcsRes, worksRes] = await Promise.all([
            fetch(`data/profile.json?t=${ts}`),
            fetch(`data/likes.json?t=${ts}`),
            fetch(`data/scenarios.json?t=${ts}`),
            fetch(`data/pcs.json?t=${ts}`),
            fetch(`data/works.json?t=${ts}`)
        ]);

        data.profile = await profileRes.json();
        data.likes = await likesRes.json();
        data.scenarios = await scenariosRes.json();
        data.pcs = await pcsRes.json();
        data.works = await worksRes.json();

        data.pcs.sort((a, b) => {
            if (a.created_at && b.created_at) {
                return b.created_at.localeCompare(a.created_at);
            }
            return 0;
        });

        loading.style.display = 'none';
    }

    function handleRoute() {
        const hash = window.location.hash.slice(1) || 'profile';

        navLinks.forEach(link => {
            if (link.dataset.target === hash) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        if (hash.startsWith('pc/')) {
            navLinks.forEach(link => link.classList.remove('active'));
            const pcId = hash.split('/')[1];
            renderPCDetail(pcId);
            return;
        }

        switch (hash) {
            case 'profile':
                renderProfile();
                break;
            case 'likes':
                renderLikes();
                break;
            case 'scenarios':
                renderScenarios();
                break;
            case 'pcs':
                renderPCList();
                break;
            case 'works':
                renderWorks();
                break;
            default:
                renderProfile();
        }
    }

    // --- Render Functions ---

    function renderProfile() {
        const p = data.profile;

        // ヘルパー：配列→段落（\n は <br> に変換）
        const listHtml = (arr) => arr.map(t => `<p>${t.replace(/\n/g, '<br>')}</p>`).join('');

        const html = `
            <section class="animate-fade-in">
                ${p.icon_url ? `
                <div class="profile-header">
                    <img src="${p.icon_url}" alt="Profile Icon" class="profile-icon">
                    <div class="profile-name-block">
                        <div class="profile-name">${p.name}</div>
                        <div class="profile-name-alts">${p.name_alts}</div>
                    </div>
                </div>
                ` : ''}

                <h2 class="section-title">プロフィール</h2>

                <!-- Session -->
                <div class="profile-item">
                    <h3 class="subsection-title profile-section-title">✧𝖲𝖾𝗌𝗌𝗂𝗈𝗇</h3>
                    <div class="profile-section-body">
                        <div class="profile-session-grid">
                            <div class="profile-session-row">
                                <span class="session-role">GM</span>
                                <span>${p.session.gm}</span>
                            </div>
                            <div class="profile-session-row">
                                <span class="session-role">PL</span>
                                <span>${p.session.pl}</span>
                            </div>
                        </div>
                        ${p.session.common && p.session.common.length > 0 ? `
                        <div class="profile-session-common">
                            ${listHtml(p.session.common)}
                        </div>` : ''}
                    </div>
                </div>

                <!-- Time -->
                <div class="profile-item">
                    <h3 class="subsection-title profile-section-title">✧𝖳𝗂𝗆𝖾</h3>
                    <div class="profile-section-body">
                        <div class="profile-time-grid">
                            <span class="time-label">平日</span><span>${p.time.weekday}</span>
                            <span class="time-label">土日祝</span><span>${p.time.weekend}</span>
                        </div>
                        ${p.time.note ? `<p class="profile-note">${p.time.note}</p>` : ''}
                    </div>
                </div>

                <!-- Rule Book -->
                ${p.rulebooks && p.rulebooks.length > 0 ? `
                <div class="profile-item">
                    <h3 class="subsection-title profile-section-title">✧𝖱𝗎𝗅𝖾 𝖡𝗈𝗈𝗄</h3>
                    <div class="profile-section-body">
                        <div class="rulebook-list">
                            ${p.rulebooks.map(rb => `
                            <div class="rulebook-system">
                                <div class="rulebook-core">${rb.core}</div>
                                ${rb.supplements && rb.supplements.length > 0 ? `
                                <ul class="rulebook-supplements">
                                    ${rb.supplements.map(s => `<li class="rulebook-supplement">${s}</li>`).join('')}
                                </ul>` : ''}
                            </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                ` : ''}

                <!-- Contact -->
                <div class="profile-item">
                    <h3 class="subsection-title profile-section-title">✧𝖢𝗈𝗇𝗍𝖺𝖼𝗍</h3>
                    <div class="profile-section-body">${listHtml(p.contact)}</div>
                </div>

                <!-- Personality -->
                <div class="profile-item">
                    <h3 class="subsection-title profile-section-title">✧𝖯𝖾𝗋𝗌𝗈𝗇𝖺𝗅𝗂𝗍𝗒</h3>
                    <div class="profile-section-body">${listHtml(p.personality)}</div>
                </div>

                <!-- Style -->
                <div class="profile-item">
                    <h3 class="subsection-title profile-section-title">✧𝖲𝗍𝗒𝗅𝖾</h3>
                    <div class="profile-section-body">${listHtml(p.style)}</div>
                </div>

                <!-- Other -->
                <div class="profile-item">
                    <h3 class="subsection-title profile-section-title">✧𝖮𝗍𝗁𝖾𝗋</h3>
                    <div class="profile-section-body">${listHtml(p.other)}</div>
                </div>

            </section>
        `;
        app.innerHTML = html;
        window.scrollTo(0, 0);
    }

    function renderLikes() {
        const l = data.likes;
        let html = `
            <section class="animate-fade-in">
                <h2 class="section-title">地雷/好物一覧</h2>

                <details open>
                    <summary>地雷一覧</summary>
                    <div class="accordion-content">
                        <div class="mines-container">
                            ${l.mines.map((group, idx) => `
                                <div class="mine-group${group.label === '控えてほしいこと' ? ' is-request' : ''}">
                                    <h3 class="planned-month-title${group.label === '恐怖症' ? ' is-phobia' : ''}" style="margin-top: ${idx === 0 ? '0' : '2em'};">
                                        <span class="title-main">${group.label}</span>
                                        ${group.note ? `<span class="mine-note">${group.note}</span>` : ''}
                                    </h3>
                                    ${group.items.length > 0 ? group.items.map(item => `
                                        <div class="mine-item">
                                            <div class="mine-title">${item.title}</div>
                                            <div class="mine-reason">${item.reason}</div>
                                        </div>
                                    `).join('') : '<div class="mine-item" style="color:#888;">なし</div>'}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </details>

                <details>
                    <summary>好きな要素</summary>
                    <div class="accordion-content">
                        ${l.likes_elements.map(group => `
                            <div class="elements-category">
                                <h4 class="elements-label">${group.label}</h4>
                                <p class="elements-text">${group.text}</p>
                                ${group.notes && group.notes.length > 0 ? `
                                    <div class="elements-notes">
                                        ${group.notes.map(note => `<span class="elements-note">${note}</span>`).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </details>

                <details>
                    <summary>好きなシナリオ</summary>
                    <div class="accordion-content">
                        ${l.likes_scenarios.note ? `<div class="planned-note">${l.likes_scenarios.note.replace(/\n/g, '<br>')}</div>` : ''}
                        <ul class="simple-list favorite-scenarios-list">
                            ${l.likes_scenarios.items.map(item => `<li>${item}</li>`).join('')}
                        </ul>
                    </div>
                </details>

                <details>
                    <summary>好きなHO</summary>
                    <div class="accordion-content">
                        ${l.likes_hos.categories.map(category => `
                            <div class="ho-category">
                                <h4 class="ho-category-label">
                                    <span class="title-main">${category.label}</span>
                                    ${category.note ? `<span class="ho-category-note">${category.note}</span>` : ''}
                                </h4>
                                <ul class="scenario-list">
                                    ${category.items.map(item => `
                                        <li class="scenario-item">
                                            <span class="scenario-title">${item.title}</span>
                                            <span class="scenario-ho-badges">
                                                ${item.hos.map(ho => `<span class="scenario-ho-badge">${ho}</span>`).join('')}
                                            </span>
                                        </li>
                                    `).join('')}
                                </ul>
                            </div>
                        `).join('')}
                    </div>
                </details>

                <details>
                    <summary>好きな作者様</summary>
                    <div class="accordion-content">
                        <ul class="simple-list">
                            ${l.likes_authors.items.map(item => `
                                <li class="author-item">
                                    <span class="author-name">${item.name}</span>
                                    ${item.note ? `<span class="author-note-badge">${item.note}</span>` : ''}
                                </li>
                            `).join('')}
                        </ul>
                        ${l.likes_authors.note || l.likes_authors.preferences ? `
                            <div class="author-preferences">
                                ${l.likes_authors.note ? `<div class="preferences-note">${l.likes_authors.note}</div>` : ''}
                                ${l.likes_authors.preferences && l.likes_authors.preferences.length > 0 ? `
                                    <ul class="preferences-list">
                                        ${l.likes_authors.preferences.map(pref => `<li>${pref}</li>`).join('')}
                                    </ul>
                                ` : ''}
                            </div>
                        ` : ''}
                    </div>
                </details>

                ${SHOW_OTHER_GENRES && l.other_genres && l.other_genres.categories && l.other_genres.categories.length > 0 ? `
                <details>
                    <summary>他ジャンル</summary>
                    <div class="accordion-content">
                        ${l.other_genres.categories.map(category => `
                            <div class="ho-category">
                                <h4 class="ho-category-label">
                                    <span class="title-main">${category.label}</span>
                                    ${category.note ? `<span class="ho-category-note">${category.note}</span>` : ''}
                                </h4>
                                <ul class="scenario-list">
                                    ${category.items.map(item => {
                                        const chars = (item.characters || []);
                                        const cpls = (item.couples || []);
                                        const hasChars = chars.length > 0;
                                        const hasCpls = cpls.length > 0;
                                        return `
                                        <li class="scenario-item other-genre-item">
                                            <span class="scenario-title">${item.title}</span>
                                            ${hasChars || hasCpls ? `<div class="other-genre-badges">
                                                ${hasChars ? `<span class="other-genre-badge-group"><span class="other-genre-badge-icon">👤</span>${chars.map(c => `<span class="scenario-ho-badge other-genre-chara">${c}</span>`).join('')}</span>` : ''}
                                                ${hasCpls ? `<span class="other-genre-badge-group"><span class="other-genre-badge-icon">💕</span>${cpls.map(c => `<span class="scenario-ho-badge other-genre-couple">${c}</span>`).join('')}</span>` : ''}
                                            </div>` : ''}
                                        </li>`;
                                    }).join('')}
                                </ul>
                            </div>
                        `).join('')}
                    </div>
                </details>
                ` : ''}
            </section>
        `;
        app.innerHTML = html;

        // Restore and save details state
        restoreDetailsState();
        document.querySelectorAll('details').forEach((details) => {
            details.addEventListener('toggle', saveDetailsState);
        });

        window.scrollTo(0, 0);
    }

    function renderScenarios() {
        const s = data.scenarios;

        // 通過済みシナリオの総数を計算
        const passedCount = s.passed ? s.passed.reduce((sum, sys) => {
            return sum + (sys.groups ? sys.groups.reduce((gSum, group) => gSum + (group.items ? group.items.length : 0), 0) : 0);
        }, 0) : 0;
        // 説明文（通過予定noteと同じレイアウト）
        const passedNote = `<div class="planned-note">
      <span class='icon-inline' style='color:#ffb300;'>★</span>　┄　シナリオが好き<br>
      <span class='icon-inline' style='vertical-align:middle;'><svg viewBox='0 0 16 16' width='1em' height='1em' fill='#ff80b0' style='position:relative;top:-0.12em;' xmlns='http://www.w3.org/2000/svg'><path d='M8 14s-5.5-3.33-5.5-7.5A3.5 3.5 0 0 1 8 3.5a3.5 3.5 0 0 1 5.5 3C13.5 10.67 8 14 8 14z'/></svg></span>　┄　HOが好き
    </div>`;
        // favorite対応 (2階層構造: system > groups > items)
        const passedContent = s.passed ? s.passed.map((sys, sysIdx) => `
            <div class="scenario-system-block">
                <h3 class="section-title" style="margin-top: ${sysIdx === 0 ? '0' : '2.0em'}; font-size: 1.4rem; border-bottom: 2px solid #ddd; padding-bottom: 0.3em; margin-bottom: 1.2em;">${sys.system}</h3>
                ${sys.groups && sys.groups.length > 0 ? sys.groups.map((group, idx) => `
                    <div class="scenario-group">
                        <h4 class="planned-month-title" style="margin-top: ${idx === 0 ? '0' : '2.0em'}; margin-bottom: 1.0em; font-size: 1.1rem;">${group.label}</h4>
                        <ul class="scenario-list">
                            ${group.items.map(item => {
            // 既存favoriteはfavorite_scenario扱い
            const favScenario = item.favorite_scenario ?? item.favorite ?? false;
            const favHo = item.favorite_ho ?? false;
            // HO有り
            if (item.ho) {
                return `<li class="scenario-item${favScenario ? ' is-favorite' : ''}">
                                                    <div class="scenario-left">
                                                        <span class="favorite-star-space">${favScenario ? '<span class="favorite-star" title="シナリオが好き">★</span>' : ''}</span>
                                                        <span class="scenario-title">${item.title}</span>
                                                    </div>
                                                    <span class="scenario-ho-badge${favHo ? ' has-favorite-ho' : ''}">
                                                        ${favHo ? `<span class="favorite-ho" title="HOが好き"><svg viewBox="0 0 16 16" fill="#ff80b0" xmlns="http://www.w3.org/2000/svg"><path d="M8 14s-5.5-3.33-5.5-7.5A3.5 3.5 0 0 1 8 3.5a3.5 3.5 0 0 1 5.5 3C13.5 10.67 8 14 8 14z"/></svg></span>` : ''}${item.ho}
                                                    </span>
                                                </li>`;
            } else {
                // HO無し
                return `<li class="scenario-item${favScenario ? ' is-favorite' : ''}">
                                                    <div class="scenario-left">
                                                        <span class="favorite-star-space">${favScenario ? '<span class="favorite-star" title="シナリオが好き">★</span>' : ''}</span>
                                                        <span class="scenario-title">${item.title}</span>
                                                    </div>
                                                </li>`;
            }
        }).join('')}
                        </ul>
                    </div>
                `).join('') : '<div class="scenario-item">なし</div>'}
            </div>
        `).join('') : '<div class="scenario-item">なし</div>';

        // 視聴/既読シナリオの総数を計算
        const watchedCount = s.watched ? s.watched.reduce((sum, sys) => {
            return sum + (sys.groups ? sys.groups.reduce((gSum, group) => gSum + (group.items ? group.items.length : 0), 0) : 0);
        }, 0) : 0;

        // watched対応 (2階層構造: system > groups > items, HO無し)
        const watchedContent = s.watched && s.watched.length > 0 ? s.watched.map((sys, sysIdx) => `
            <div class="scenario-system-block">
                <h3 class="section-title" style="margin-top: ${sysIdx === 0 ? '0' : '2.0em'}; font-size: 1.4rem; border-bottom: 2px solid #ddd; padding-bottom: 0.3em; margin-bottom: 1.2em;">${sys.system}</h3>
                ${sys.groups && sys.groups.length > 0 ? sys.groups.map((group, idx) => `
                    <div class="scenario-group">
                        <h4 class="planned-month-title" style="margin-top: ${idx === 0 ? '0' : '2.0em'}; margin-bottom: 1.0em; font-size: 1.1rem;">${group.label}</h4>
                        <ul class="scenario-list">
                            ${group.items.map(item => {
            const favScenario = item.favorite ?? false;
            return `<li class="scenario-item${favScenario ? ' is-favorite' : ''}">
                                    <div class="scenario-left">
                                        <span class="favorite-star-space">${favScenario ? '<span class="favorite-star" title="シナリオが好き">★</span>' : ''}</span>
                                        <span class="scenario-title">${item.title}</span>
                                    </div>
                                </li>`;
        }).join('')}
                        </ul>
                    </div>
                `).join('') : '<div class="scenario-item">なし</div>'}
            </div>
        `).join('') : '<div class="scenario-item">なし</div>';

        // GM経験有りシナリオの総数を計算
        const gmCount = s.gm ? s.gm.reduce((sum, sys) => {
            return sum + (sys.groups ? sys.groups.reduce((gSum, group) => gSum + (group.items ? group.items.length : 0), 0) : 0);
        }, 0) : 0;

        // gm対応 (2階層構造: system > groups > items, 回数表示有り)
        const gmContent = s.gm && s.gm.length > 0 ? s.gm.map((sys, sysIdx) => `
            <div class="scenario-system-block">
                <h3 class="section-title" style="margin-top: ${sysIdx === 0 ? '0' : '2.0em'}; font-size: 1.4rem; border-bottom: 2px solid #ddd; padding-bottom: 0.3em; margin-bottom: 1.2em;">${sys.system}</h3>
                ${sys.groups && sys.groups.length > 0 ? sys.groups.map((group, idx) => `
                    <div class="scenario-group">
                        <h4 class="planned-month-title" style="margin-top: ${idx === 0 ? '0' : '2.0em'}; margin-bottom: 1.0em; font-size: 1.1rem;">${group.label}</h4>
                        <ul class="scenario-list">
                            ${group.items.map(item => {
            // 回数のバッジ (ほどよく目立つデザインに調整)
            const countContent = item.count ? `<span class="scenario-count-badge" style="margin-left:10px; padding:2px 8px; background-color:#fff8e1; color:#f57c00; border:1px solid #ffb74d; border-radius:12px; font-size:0.85em; white-space:nowrap;">${item.count}回</span>` : '';
            return `<li class="scenario-item">
                                    <div class="scenario-left" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                                        <div style="display: flex; align-items: center;">
                                            <span class="scenario-title">${item.title}</span>
                                        </div>
                                        ${countContent}
                                    </div>
                                </li>`;
        }).join('')}
                        </ul>
                    </div>
                `).join('') : '<div class="scenario-item">なし</div>'
            }
            </div>
            `).join('') : '<div class="scenario-item">なし</div>';

        let plannedContent = '';
        if (s.planned_schedule) {
            const ps = s.planned_schedule;
            if (ps.note) {
                plannedContent += `<div class="planned-note">${ps.note.replace(/\n/g, '<br>')}</div>`;
            }
            if (ps.months) {
                plannedContent += ps.months.map(month => `
                    <div class="planned-block">
                        <div class="planned-month-title">${month.label}</div>
                        <ul class="planned-list">
                            ${month.items.map(mItem => `
                                <li class="planned-item">
                                    <span class="planned-item-title">${mItem.title}</span>
                                    ${mItem.role ? `<span class="planned-item-role">${mItem.role}</span>` : ''}
                                </li>
                            `).join('')}
                        </ul>
                    </div>
            `).join('');
            }
        }

        let html = `
            <section class="animate-fade-in">
                <h2 class="section-title">通過済み/予定シナリオ一覧</h2>

                <details open>
                    <summary>通過予定・スケジュール</summary>
                    <div class="accordion-content">
                        <div class="planned-section">
                            ${plannedContent}
                        </div>
                    </div>
                </details>

                <details open>
                    <summary><span class="scenario-header-flex"><span>通過済シナリオ一覧</span><span class="scenario-count">(${passedCount})</span></span></summary>
                    <div class="accordion-content">
                        <div class="scenario-list-container">
                            ${passedNote}
                            ${passedContent}
                        </div>
                    </div>
                </details>

                <details open>
                    <summary><span class="scenario-header-flex"><span>視聴・既読シナリオ一覧</span><span class="scenario-count">(${watchedCount})</span></span></summary>
                    <div class="accordion-content">
                        <div class="scenario-list-container">
                            ${watchedContent}
                        </div>
                    </div>
                </details>

                <!-- GM経験有りシナリオ (一時的に非表示)
                <details open>
                    <summary><span class="scenario-header-flex"><span>GM経験有りシナリオ一覧</span><span class="scenario-count">(${gmCount})</span></span></summary>
                    <div class="accordion-content">
                        <div class="scenario-list-container">
                            ${gmContent}
                        </div>
                    </div>
                </details>
                -->
            </section>
        `;
        app.innerHTML = html;
        window.scrollTo(0, 0);
    }

    function renderPCList() {
        let html = `
            <section class="animate-fade-in">
                <h2 class="section-title">探索者一覧</h2>
                <div class="pc-grid">
                    ${data.pcs.filter(pc => !pc.is_hidden).map(pc => {
            const iconSrc = pc.image_icon || generatePlaceholderImage(pc.name, 200, 200);
            const isLost = pc.is_lost || false;
            const lostIconClass = isLost ? ' is-lost' : '';
            const lostNameClass = isLost ? ' is-lost-name' : '';
            return `
                            <div class="pc-thumbnail" onclick="location.hash='#pc/${pc.id}'">
                                <img src="${iconSrc}" alt="${pc.name}" class="pc-icon${lostIconClass}" loading="lazy">
                                <div class="pc-name-thumb${lostNameClass}">${pc.name}</div>
                            </div>
                        `;
        }).join('')}
                </div>
            </section>
        `;
        app.innerHTML = html;

        // Restore and save details state
        restoreDetailsState();
        document.querySelectorAll('details').forEach((details) => {
            details.addEventListener('toggle', saveDetailsState);
        });

        window.scrollTo(0, 0);
    }

    function renderWorks() {
        const w = data.works;
        const statusMap = {
            'published': { text: '公開済', class: 'status-published' },
            'wip': { text: '制作中', class: 'status-wip' },
            'private': { text: '非公開', class: 'status-private' }
        };

        let html = `
            <section class="animate-fade-in">
                <h2 class="section-title">自作シナリオ一覧</h2>
                <div class="works-grid">
                    ${w.map(work => {
            const st = statusMap[work.status] || { text: work.status, class: 'status-private' };
            const ratingBadge = work.rating ? `<span class="rating-badge">${work.rating.toUpperCase()}</span>` : '';

            const cardContent = `
                            <div class="work-header">
                                <h3 class="work-title">${work.title}</h3>
                            </div>
                            <div class="work-badges">
                                <span class="status-badge ${st.class}">${st.text}</span>
                                ${ratingBadge}
                            </div>
                            <div class="work-specs">
                                <span class="work-spec-item">👤 ${work.players}</span>
                                <span class="work-spec-item">⏱ ${work.time}</span>
                                <span class="work-spec-item">🏷 HO: ${work.ho}</span>
                            </div>
                            <p class="work-summary">${work.summary}</p>
                        `;

            if (work.url) {
                return `
                                <a href="${work.url}" class="work-card has-link" target="_blank" rel="noopener noreferrer">
                                    ${cardContent}
                                </a>
                            `;
            } else {
                return `
                                <div class="work-card">
                                    ${cardContent}
                                </div>
                            `;
            }
        }).join('')}
                </div>
            </section>
        `;
        app.innerHTML = html;

        // Restore and save details state
        restoreDetailsState();
        document.querySelectorAll('details').forEach((details) => {
            details.addEventListener('toggle', saveDetailsState);
        });

        window.scrollTo(0, 0);
    }

    function renderPCDetail(pcId) {
        const pc = data.pcs.find(p => p.id === pcId && !p.is_hidden);
        if (!pc) {
            app.innerHTML = '<p>探索者が見つかりません。</p>';
            return;
        }

        const diffsHtml = pc.images_diff && pc.images_diff.length > 0
            ? `<div class="pc-diff-images">
            ${pc.images_diff.map(src => `<img src="${src}" class="pc-diff-thumb" alt="差分" onclick="openModal('${src}', '${pc.name}')" style="cursor: pointer;">`).join('')}
               </div>`
            : '';

        const artsHtml = pc.arts && pc.arts.length > 0
            ? `<div class="gallery-grid">
            ${pc.arts.map(art => {
                // 全ページ配列を構築 (url + pages)
                const allPages = [art.url, ...((art.pages || []).filter(p => p))];
                const pageCount = allPages.length;
                const pagesJsonAttr = JSON.stringify(allPages).replace(/"/g, '&quot;');
                const captionText = `Art by ${art.artist} \u69d8`;

                if (art.spoiler) {
                    const spoilerScenario = art.spoiler_scenario || '';
                    const pagesJsonSafe = JSON.stringify(allPages).replace(/"/g, '&quot;');
                    return `
                    <div class="gallery-item spoiler-item" onclick="openSpoilerConfirm('${art.url}', '${captionText}', '${spoilerScenario.replace(/'/g, "\\'")}', ${pagesJsonSafe})">
                        <div class="gallery-thumb spoiler-thumb">
                            <span class="spoiler-icon">\u26a0</span>
                            <span class="spoiler-label">\u30cd\u30bf\u30d0\u30ec\u3042\u308a</span>
                            <span class="spoiler-sub">\u30af\u30ea\u30c3\u30af\u3057\u3066\u78ba\u8a8d</span>
                        </div>
                        ${pageCount > 1 ? `<span class="gallery-page-badge">\ud83d\uddbc ${pageCount}\u679a</span>` : ''}
                        <div class="artist-name">By ${art.artist} \u69d8</div>
                    </div>`;
                } else {
                    return `
                    <div class="gallery-item" onclick="openModal('${art.url}', '${captionText}', ${pagesJsonAttr})">
                        <img src="${art.url}" class="gallery-thumb" alt="${captionText}" loading="lazy">
                        ${pageCount > 1 ? `<span class="gallery-page-badge">\ud83d\uddbc ${pageCount}\u679a</span>` : ''}
                        <div class="artist-name">By ${art.artist} \u69d8</div>
                    </div>`;
                }
            }).join('')
            }
               </div>`
            : '';


        const scenariosHtml = pc.passed_scenarios && pc.passed_scenarios.length > 0
            ? `<ul class="scenario-list">
            ${pc.passed_scenarios.map(sc => {
                let title, ho, end, isIf;
                if (typeof sc === 'object') {
                    title = sc.title || '';
                    ho = sc.ho || '';
                    end = sc.end || '';
                    isIf = sc.is_if || false;
                } else {
                    // 旧形式(文字列)の互換性
                    title = sc;
                    ho = '';
                    end = '';
                    isIf = false;
                }

                const isFavHo = sc.favorite_ho || false;
                let hoBadgeHtml = '';
                let endBadgeHtml = '';

                if (isIf) {
                    title = `<span class="scenario-if-badge">IF</span>${title}`;
                }

                if (ho) {
                    hoBadgeHtml = `<span class="scenario-ho-badge${isFavHo ? ' has-favorite-ho' : ''}">
                        ${isFavHo ? `<span class="favorite-ho" title="HOが好き"><svg viewBox="0 0 16 16" fill="#ff80b0" xmlns="http://www.w3.org/2000/svg" style="width:1em;height:1em;vertical-align:text-bottom;"><path d="M8 14s-5.5-3.33-5.5-7.5A3.5 3.5 0 0 1 8 3.5a3.5 3.5 0 0 1 5.5 3C13.5 10.67 8 14 8 14z"/></svg></span>` : ''}${ho}
                    </span>`;
                }
                if (end) {
                    endBadgeHtml = `<span class="scenario-end-badge">${end}</span>`;
                }

                return `<li class="scenario-item">
                    <span class="scenario-title-text">${title}${hoBadgeHtml}</span>
                    ${endBadgeHtml ? `<span class="scenario-end-wrapper">${endBadgeHtml}</span>` : ''}
                </li>`;
            }).join('')
            }
               </ul>`
            : '<p>登録なし</p>';


        const isLost = pc.is_lost || false;
        const lostNameClass = isLost ? ' is-lost-name' : '';
        const lostBadge = isLost ? '<span class="lost-badge">ロスト</span>' : '';

        let html = `
            <section class="animate-fade-in">
                <div style="margin-bottom: 10px;">
                    <a href="#pcs" style="color: #666;">&lt; 一覧に戻る</a>
                </div>
                
                <h2 class="section-title"><span class="${lostNameClass}">${pc.name}</span>${pc.ruby ? ` <span style="font-size: 0.8rem; font-weight: normal;">(${pc.ruby})</span>` : ''}${lostBadge}</h2>
                
                <div class="pc-detail-container">
                    <div class="pc-tachie-container">
                        <img src="${pc.image_main || generatePlaceholderImage(pc.name, 400, 800)}" alt="${pc.name}" class="pc-tachie" onclick="openModal(this.src, '${pc.name}')" style="cursor: pointer;">
                        ${diffsHtml}
                    </div>

                    <div class="pc-info">
                        <div class="pc-basic-info">
                            <h3 class="subsection-title" style="margin-top: 0;">基本データ</h3>
                            <dl>
                                <dt>性別</dt><dd>${pc.profile.gender}</dd>
                                <dt>年齢</dt><dd>${pc.profile.age}</dd>
                                <dt>身長</dt><dd>${pc.profile.height}</dd>
                                <dt>職業</dt><dd>${pc.profile.job}</dd>
                            </dl>
                        </div>

                        <div class="pc-scenarios">
                            <h3 class="subsection-title">通過済シナリオ</h3>
                            ${scenariosHtml}
                        </div>

                        ${artsHtml ? `
                        <div class="pc-gallery">
                            <h3 class="subsection-title">GALLERY (Skeb)</h3>
                            ${artsHtml}
                        </div>
                        ` : ''}
                    </div>
                </div>
            </section>
        `;
        app.innerHTML = html;
        window.scrollTo(0, 0);
    }

    // スライド表示拴新関数
    function _updateSlide() {
        modalImg.src = _slidePages[_slideIndex];
        if (_slidePages.length > 1) {
            modalCounter.textContent = `${_slideIndex + 1} / ${_slidePages.length}`;
            modalCounter.style.display = 'block';
            modalPrev.style.display = 'block';
            modalNext.style.display = 'block';
        } else {
            modalCounter.style.display = 'none';
            modalPrev.style.display = 'none';
            modalNext.style.display = 'none';
        }
    }

    window.openModal = function (src, caption, pages) {
        // pagesが配列ならスライドショー、なければ単筆
        _slidePages = (Array.isArray(pages) && pages.length > 0) ? pages : [src];
        _slideIndex = 0;
        modalCaption.textContent = caption || '';
        modal.classList.add('show');
        _updateSlide();
    }

    modalPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_slidePages.length < 2) return;
        _slideIndex = (_slideIndex - 1 + _slidePages.length) % _slidePages.length;
        _updateSlide();
    });

    modalNext.addEventListener('click', (e) => {
        e.stopPropagation();
        if (_slidePages.length < 2) return;
        _slideIndex = (_slideIndex + 1) % _slidePages.length;
        _updateSlide();
    });

    // キーボード操作対応
    document.addEventListener('keydown', (e) => {
        if (!modal.classList.contains('show')) return;
        if (e.key === 'ArrowLeft') {
            _slideIndex = (_slideIndex - 1 + _slidePages.length) % _slidePages.length;
            _updateSlide();
        } else if (e.key === 'ArrowRight') {
            _slideIndex = (_slideIndex + 1) % _slidePages.length;
            _updateSlide();
        } else if (e.key === 'Escape') {
            modal.classList.remove('show');
            modalImg.src = '';
        }
    });

    // ネタバレ確認ダイアログを開く
    window.openSpoilerConfirm = function (src, caption, scenarioName, pages) {
        const dialog = document.getElementById('spoiler-dialog');
        if (!dialog) return;
        const bodyEl = dialog.querySelector('.spoiler-dialog-body');
        if (bodyEl) {
            const name = scenarioName ? `「${scenarioName}」` : 'シナリオ';
            bodyEl.innerHTML = `このイラストには${name}のネタバレが含まれます。<br>表示してもよろしいですか？`;
        }
        dialog.classList.add('show');
        dialog.dataset.src = src;
        dialog.dataset.caption = caption || '';
        // 複数ページ情報をdata属性に保持
        dialog.dataset.pages = JSON.stringify(
            (Array.isArray(pages) && pages.length > 0) ? pages : [src]
        );
    }

    // ネタバレ確認ダイアログのボタン処理
    document.addEventListener('click', (e) => {
        const dialog = document.getElementById('spoiler-dialog');
        if (!dialog) return;
        if (e.target.id === 'spoiler-confirm-yes') {
            dialog.classList.remove('show');
            const savedPages = JSON.parse(dialog.dataset.pages || 'null');
            openModal(dialog.dataset.src, dialog.dataset.caption, savedPages);
        }
        if (e.target.id === 'spoiler-confirm-no' || e.target.id === 'spoiler-dialog-overlay') {
            dialog.classList.remove('show');
        }
    });

    closeModal.addEventListener('click', () => {
        modal.classList.remove('show');
        modalImg.src = '';
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('show');
            modalImg.src = '';
        }
    });

    // Functions to save and restore details state
    function saveDetailsState() {
        const detailsElements = document.querySelectorAll('details');
        const state = {};
        detailsElements.forEach((details) => {
            const summary = details.querySelector('summary');
            if (summary) {
                state[summary.textContent.trim()] = details.open;
            }
        });
        localStorage.setItem('detailsState', JSON.stringify(state));
    }

    function restoreDetailsState() {
        const savedState = localStorage.getItem('detailsState');
        if (savedState) {
            const state = JSON.parse(savedState);
            document.querySelectorAll('details').forEach((details) => {
                const summary = details.querySelector('summary');
                if (summary) {
                    const key = summary.textContent.trim();
                    if (state.hasOwnProperty(key)) {
                        details.open = state[key];
                    }
                }
            });
        }
    }
});
