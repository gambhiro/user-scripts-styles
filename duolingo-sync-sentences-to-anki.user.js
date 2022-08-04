// ==UserScript==
// @name         Duolingo: Sync review sentences to Anki
// @description  Sync translation exercise 'Write in Italian/etc.' sentences to Anki
// @version      1.0.0
// @author       gambhiro
// @license      unlicense
// @match        https://www.duolingo.com/*
// @namespace    Violentmonkey Scripts
// @grant        none
// @inject-into  content
// @homepageURL  https://github.com/gambhiro/user-scripts-styles
// @downloadURL  https://github.com/gambhiro/user-scripts-styles/raw/main/duolingo-sync-sentences-to-anki.user.js
// ==/UserScript==

/*
 * At the end of a Duolingo lesson, this script will extract the translation
 * exercise 'Write in Italian/etc.' sentences from the review scoreboard, and
 * sync them to Anki. The AnkiConnect plugin has to be installed in Anki.
 *
 * If Anki is not open, a TSV (tab seperated values) list is shown.
 *
 * The ANKI_DECK variable specifies the deck.
 *
 * The AUTO_SYNC variable enables/disables auto-sync at the end of a lesson.
 *
 * For stories, syncing has to be triggered with the keybinding below. It works
 * even at the beginning of a story, one doesn't have to wait until the last
 * sentence.
 *
 * Ctrl+Alt+L (Cmd+Opt+L on Mac) triggers the syncing manually. This works
 * either at the end of a lesson, or on a story page.
 *
 * In stories, it will sync the story sentences with a tag 'translate_me', since
 * the English translation is not on the page.
 */

const ANKI_DECK = 'Duolingo Sentences';

const AUTO_SYNC = true;

// Review button
const review_sel = "button.WOZnx._275sd._1ZefG._2ugbF.U1P3s._40EaN span";
// Learn button
const learn_sel = "a[data-test=home-nav] span._288DZ";

// correct cards (green): "._2eeKH._2TVVG._32YlO"
// incorrect cards (red): "._2eeKH._2TVVG.lk2xf"
const cards_sel = "._2eeKH._2TVVG";
const q_head_sel = "._3WHhh";
const q_txt_sel = ".UWDnp";
const a_txt_sel = "._1MehU ._21MzE";

const story_line_sel = "._3sNGF._3j32v[data-test=stories-element] ._3jGFa._1e1GW._2lvkY";

// https://stackoverflow.com/questions/5525071/how-to-wait-until-an-element-exists

function wait_for_el(selector) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                resolve(document.querySelector(selector));
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

function selector_with_text(selector = '', has_text = '') {
    var el = document.querySelector(selector);
    if (el && has_text.length > 0 && el.innerText.toLowerCase() != has_text) {
        el = null;
    }
    return el;
}

// https://www.matthias-kappenberg.de/tuts-snippets/javascript-delayed-load

function timer_wait_for(selector = '', has_text = '', action_callback, delay = 300, tries = 10, try_forever = false) {
    var el = selector_with_text(selector, has_text);

    setTimeout(function () {
        if (!try_forever) {
            tries--;
        }

        if (el) {
            // we have a match
            action_callback(el);
        } else if (tries > 0) {
            // we are not ready, let's try again
            setTimeout(function () {
                timer_wait_for(selector, has_text, action_callback, delay, tries, try_forever)
            }, delay);
            // console.log('Try: ' + tries);
        } else {
            // no match, give up
            // console.log('No match, give up');
        }
    }, delay);
}

// https://foosoft.net/projects/anki-connect/index.html

function anki_invoke(action, version, params={}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('error', () => reject('failed to issue request'));
        xhr.addEventListener('load', () => {
            try {
                const response = JSON.parse(xhr.responseText);
                if (Object.getOwnPropertyNames(response).length != 2) {
                    throw 'response has an unexpected number of fields';
                }
                if (!response.hasOwnProperty('error')) {
                    throw 'response is missing required error field';
                }
                if (!response.hasOwnProperty('result')) {
                    throw 'response is missing required result field';
                }
                if (response.error) {
                    throw response.error;
                }
                resolve(response.result);
            } catch (e) {
                reject(e);
            }
        });

        xhr.open('POST', 'http://127.0.0.1:8765');
        xhr.send(JSON.stringify({action, version, params}));
    });
}

async function is_ankiconnect_running() {
    const server_ok = await fetch('http://127.0.0.1:8765')
          .then(r => (r.ok == true))
          .catch(e => false);

    return server_ok;
}

function texts_to_tsv_uniq(texts) {
    const a = texts.map(i => i[0] + "\t" + i[1]);
    const b = [...new Set(a)];
    return b.join("\n");
}

async function texts_sync_to_anki(texts = [], tags = ["duolingo"]) {
    const notes = texts.map((i) => {
        return {
                "deckName": ANKI_DECK,
                "modelName": "Basic",
                "fields": {
                    "Front": i[0],
                    "Back": i[1],
                },
                "tags": tags,
        };
    });

    // Make sure the deck exists. createDeck doesn't overwrite an existing deck.
    await anki_invoke('createDeck', 6, {deck: ANKI_DECK});

    const result = await anki_invoke('addNotes', 6, {notes: notes});

    // remove null and duplicate IDs of repeated sentences
    var a = [...new Set(result.filter(i => i !== null))];

    return a.length;
}

async function collect_cards() {
    var texts = [];

    const cards = document.querySelectorAll(cards_sel);

    for (var i=0; i<cards.length; i++) {
        cards[i].click();

        // Question header
        const q_head = cards[i].querySelector(q_head_sel).innerText;

        const write_in_english = (q_head === 'Write in English:');
        const write_in_lang = (q_head.startsWith('Write in'));

        // Question text: Noi mangi
        const q_txt = cards[i].querySelector(q_txt_sel).innerText;

        var a_txt;

        wait_for_el(a_txt_sel).then((el) => {
            // Answer text: We eat the buiscuits.
            a_txt = el.innerText;
        });

        await Promise.all([a_txt]);

        if (write_in_english) {
            texts.push([a_txt, q_txt]);
        } else if (write_in_lang) {
            texts.push([q_txt, a_txt]);
        }
    }

    await Promise.all(texts);

    const server_ok = await is_ankiconnect_running();

    var msg = '';

    if (server_ok) {
        var n = await texts_sync_to_anki(texts);
        msg = n + " sentences were synced to Anki (already existing notes are skipped).\n\n";
    }

    var result = texts_to_tsv_uniq(texts);
    msg += "All extracted sentences in TSV format:\n```\n" + result + "\n```";

    msg += "\n\nContinue to the skill tree?"

    const do_continue = confirm(msg);

    if (do_continue) {
        // Review modal close button
        const close_sel = "._1hEOp._13Rl7._3lUbm._18W4a.xtPuL .FrL-W[data-test=close-button]";
        timer_wait_for(close_sel, '', el => el.click(), 300, 10, true);

        // Click the continue button
        var el = document.querySelector("button._3HhhB._2NolF._275sd._1ZefG._2orIw._3PphB._9C_ii[data-test=player-next] span._13HXc");
        if (el && el.innerText.toLowerCase() == "continue") {
            el.click();
        }
    }
}

async function click_review(el) {
    el.click()
    // Wait for review modal
    // the modal: "._1hEOp._13Rl7._3lUbm._18W4a.xtPuL"
    // the header: "._1LruX" Check out your scorecard!
    // Using the selector for a card, selector for the modal doesn't work
    await wait_for_el(cards_sel).then((el) => {
        collect_cards();
    });

    // Wait until we're back to the skill tree,
    // then start waiting for the next review
    if (AUTO_SYNC) {
        timer_wait_for(learn_sel, "learn",
                       function(el) {
                           timer_wait_for(review_sel, "review lesson", click_review, 300, 10, true);
                       },
                       300, 10, true);
    }
}

async function collect_story_sentences() {
    var texts = [];

    const story_lines = document.querySelectorAll(story_line_sel);

    for (var i=0; i<story_lines.length; i++) {
        const q_txt = story_lines[i].innerText;
        // There are no translations in the story DOM.
        texts.push([q_txt, q_txt]);
    }

    const server_ok = await is_ankiconnect_running();

    var msg = '';

    if (server_ok) {
        var n = await texts_sync_to_anki(texts, ["duolingo", "translate_me"]);
        msg = n + " sentences were synced to Anki (already existing notes are skipped).\n\n";
    }

    var result = texts_to_tsv_uniq(texts);
    msg += "All extracted sentences in TSV format:\n```\n" + result + "\n```";

    alert(msg);
}

if (AUTO_SYNC) {
    timer_wait_for(review_sel, "review lesson", click_review, 300, 10, true);
}

// Ctrl+Alt+L
// Cmd+Opt+L (Mac)
document.addEventListener('keydown', function(e) {
    if (e.key == 'l' && (e.ctrlKey || e.metaKey) && e.altKey) {
        // If there are review cards, collect them
        var c_el = selector_with_text(cards_sel);
        if (c_el) {
            collect_cards();
        } else {
            // Or click the Review Lesson button and collect cards
            var r_el = selector_with_text(review_sel, "review lesson");
            if (r_el) {
                click_review(r_el);
            } else {
                // Or collect story sentences
                collect_story_sentences();
            }
        }
    }
});

console.log(GM_info.script.name + ', v' + GM_info.script.version);

