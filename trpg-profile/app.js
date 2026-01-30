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
    const closeModal = document.querySelector('.close-modal');

    let data = {
        profile: null,
        likes: null,
        scenarios: null,
        pcs: null,
        works: null
    };

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
        let html = `
            <section class="animate-fade-in">
                ${p.icon_url ? `
                <div class="profile-header">
                    <img src="${p.icon_url}" alt="Profile Icon" class="profile-icon">
                </div>
                ` : ''}

                <h2 class="section-title">プロフィール</h2>
                
                <div class="profile-item">
                    <h3 class="subsection-title">セッション可能時間</h3>
                    <p>${p.play_time.replace(/\n/g, '<br>')}</p>
                </div>

                <div class="profile-item">
                    <h3 class="subsection-title">卓スタイル・傾向</h3>
                    <p>${p.style.replace(/\n/g, '<br>')}</p>
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
                            ${l.mines.map(mine => `
                                <div class="mine-item">
                                    <div class="mine-level">【${mine.level}】 ${mine.title}</div>
                                    <div class="mine-reason">${mine.reason}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </details>

                <details>
                    <summary>好きな要素</summary>
                    <div class="accordion-content">
                        <ul class="simple-list">
                            ${l.likes_elements.map(item => `<li>${item}</li>`).join('')}
                        </ul>
                    </div>
                </details>

                <details>
                    <summary>好きなシナリオ</summary>
                    <div class="accordion-content">
                        <ul class="simple-list">
                            ${l.likes_scenarios.map(item => `<li>${item}</li>`).join('')}
                        </ul>
                    </div>
                </details>

                <details>
                    <summary>好きなHO</summary>
                    <div class="accordion-content">
                        <ul class="scenario-list">
                            ${l.likes_hos.map(item => `
                                <li class="scenario-item">
                                    <div class="scenario-left">
                                        <span class="scenario-title">${item.title}</span>
                                        ${item.ho ? `<span class="scenario-ho">${item.ho}</span>` : ''}
                                    </div>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                </details>
            </section>
        `;
        app.innerHTML = html;
        window.scrollTo(0, 0);
    }

    function renderScenarios() {
        const s = data.scenarios;

        // 通過済みシナリオの総数を計算
        const passedCount = s.passed ? s.passed.reduce((sum, group) => sum + (group.items ? group.items.length : 0), 0) : 0;
        // 説明文（通過予定noteと同じレイアウト）
        const passedNote = `<div class="planned-note">
      <span class='icon-inline' style='color:#ffb300;'>★</span>　┄　シナリオが好き<br>
      <span class='icon-inline' style='vertical-align:middle;'><svg viewBox='0 0 16 16' width='1em' height='1em' fill='#ff80b0' style='position:relative;top:-0.12em;' xmlns='http://www.w3.org/2000/svg'><path d='M8 14s-5.5-3.33-5.5-7.5A3.5 3.5 0 0 1 8 3.5a3.5 3.5 0 0 1 5.5 3C13.5 10.67 8 14 8 14z'/></svg></span>　┄　HOが好き
    </div>`;
        // favorite対応
        const passedContent = s.passed ? s.passed.map((group, idx) => `
            <div class="scenario-group">
                <h3 class="planned-month-title" style="margin-top: ${idx === 0 ? '0' : '2.5em'}; margin-bottom: 1.2em;">${group.label}</h3>
                <ul class="scenario-list">
                    ${group.items.map(item => {
                        // 既存favoriteはfavorite_scenario扱い
                        const favScenario = item.favorite_scenario ?? item.favorite ?? false;
                        const favHo = item.favorite_ho ?? false;
                        // HO有り
                        if (item.ho) {
                            return `<li class="scenario-item${favScenario ? ' is-favorite' : ''}">
                                <span class="scenario-title">${item.title}</span>
                                <span class="scenario-ho-badge">${item.ho}
                                    ${favHo ? `<span class="favorite-ho" title="HOが好き"><svg viewBox="0 0 16 16" fill="#ff80b0" xmlns="http://www.w3.org/2000/svg"><path d="M8 14s-5.5-3.33-5.5-7.5A3.5 3.5 0 0 1 8 3.5a3.5 3.5 0 0 1 5.5 3C13.5 10.67 8 14 8 14z"/></svg></span>` : ''}
                                </span>
                                <span class="favorite-star-space">${favScenario ? '<span class="favorite-star" title="シナリオが好き">★</span>' : '&nbsp;'}</span>
                            </li>`;
                        } else {
                            // HO無し
                            return `<li class="scenario-item${favScenario ? ' is-favorite' : ''}">
                                <span class="scenario-title">${item.title}</span>
                                <span class="favorite-star-space">${favScenario ? '<span class="favorite-star" title="シナリオが好き">★</span>' : '&nbsp;'}</span>
                            </li>`;
                        }
                    }).join('')}
                </ul>
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
                    ${data.pcs.map(pc => `
                        <div class="pc-thumbnail" onclick="location.hash='#pc/${pc.id}'">
                            <img src="${pc.image_icon}" alt="${pc.name}" class="pc-icon" loading="lazy">
                            <div class="pc-name-thumb">${pc.name}</div>
                        </div>
                    `).join('')}
                </div>
            </section>
        `;
        app.innerHTML = html;
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

            return `
                        <div class="work-card">
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
                        </div>
                        `;
        }).join('')}
                </div>
            </section>
        `;
        app.innerHTML = html;
        window.scrollTo(0, 0);
    }

    function renderPCDetail(pcId) {
        const pc = data.pcs.find(p => p.id === pcId);
        if (!pc) {
            app.innerHTML = '<p>探索者が見つかりません。</p>';
            return;
        }

        const diffsHtml = pc.images_diff && pc.images_diff.length > 0
            ? `<div class="pc-diff-images">
                ${pc.images_diff.map(src => `<img src="${src}" class="pc-diff-thumb" alt="差分">`).join('')}
               </div>`
            : '';

        const artsHtml = pc.arts && pc.arts.length > 0
            ? `<div class="gallery-grid">
                ${pc.arts.map(art => `
                    <div class="gallery-item" onclick="openModal('${art.url}', '${art.artist}')">
                        <img src="${art.url}" class="gallery-thumb" alt="Art by ${art.artist}" loading="lazy">
                        <div class="artist-name">By ${art.artist}</div>
                    </div>
                `).join('')}
               </div>`
            : '<p>登録されているイラストはありません。</p>';

        const scenariosHtml = pc.passed_scenarios && pc.passed_scenarios.length > 0
            ? `<ul class="scenario-list">
                ${pc.passed_scenarios.map(sc => `<li class="scenario-item">${sc}</li>`).join('')}
               </ul>`
            : '<p>登録なし</p>';

        let html = `
            <section class="animate-fade-in">
                <div style="margin-bottom: 10px;">
                    <a href="#pcs" style="color: #666;">&lt; 一覧に戻る</a>
                </div>
                
                <h2 class="section-title">${pc.name} <span style="font-size: 0.8rem; font-weight: normal;">(${pc.ruby})</span></h2>
                
                <div class="pc-detail-container">
                    <div class="pc-tachie-container">
                        <img src="${pc.image_main}" alt="${pc.name}" class="pc-tachie">
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

                        <div class="pc-gallery">
                            <h3 class="subsection-title">GALLERY (Skeb / FA)</h3>
                            ${artsHtml}
                        </div>
                    </div>
                </div>
            </section>
        `;
        app.innerHTML = html;
        window.scrollTo(0, 0);
    }

    window.openModal = function (src, caption) {
        modalImg.src = src;
        modalCaption.textContent = caption ? `Art by ${caption}` : '';
        modal.classList.add('show');
    }

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
});
