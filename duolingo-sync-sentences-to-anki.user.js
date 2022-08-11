// ==UserScript==
// @name         Duolingo: Sync review sentences to Anki
// @description  Sync translation exercise 'Write in Italian/etc.' sentences to Anki.
// @version      1.1.0
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
 * This script will extract translation exercises ('Write in Italian/etc.') on
 * Duolingo and sync them to Anki. The AnkiConnect plugin has to be installed in
 * Anki.
 *
 * If Anki is not open, a TSV (tab seperated values) list is shown.
 *
 * The ANKI_DECK variable specifies the deck.
 *
 * The AUTO_SYNC variable enables/disables auto-sync at the end of a lesson.
 *
 * The NOTIFY variable enables/disables sync notifications.
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
 *
 * Changelog:
 *
 * [2022-08-11] v1.1.0 Sync from individual translation exercises.
 * [2022-08-04] v1.0.0 Sync from Review scorecards and stories.
 */

const ANKI_DECK = 'Duolingo Sentences';

const AUTO_SYNC = true;

const NOTIFY = true;

const DEBUG_LOG = false;

// Review button
const review_sel = "button.WOZnx._275sd._1ZefG._2ugbF.U1P3s._40EaN span";
// Learn button
const learn_sel = "a[data-test=home-nav] span._288DZ";
// Write this in English, word bank or textarea
const translate_sel = ".e4VJZ.FQpeZ[data-test='challenge challenge-translate']";
// Type the missing word
const type_missing_sel = ".e4VJZ.FQpeZ[data-test='challenge challenge-listenComplete']";
// Tap what you hear
const listen_tap_sel = ".e4VJZ.FQpeZ[data-test='challenge challenge-listenTap']";
// Select the missing word
const select_missing_sel = ".e4VJZ.FQpeZ[data-test='challenge challenge-form']";

// Write this in English (header)
const tr_q_head_sel = "._2LZl6[data-test=challenge-header]";
// Sentence to translate
const tr_question_sel = "._1KUxv._11rtD";

const tr_answer_words_sel = "._2PLYW";
const tr_answer_input_sel = "textarea[data-test=challenge-translate-input]";

const tr_answer_correct_text_sel = ".kVhsm[data-test='blame blame-correct'] ._1UqAr";
const tr_answer_incorrect_text_sel = ".kVhsm[data-test='blame blame-incorrect'] ._1UqAr";

const tr_blame_correct_sel = ".kVhsm[data-test='blame blame-correct']";
const tr_blame_incorrect_sel = ".kVhsm[data-test='blame blame-incorrect']";

// correct cards (green): "._2eeKH._2TVVG._32YlO"
// incorrect cards (red): "._2eeKH._2TVVG.lk2xf"
const cards_sel = "._2eeKH._2TVVG";
const q_head_sel = "._3WHhh";
const q_txt_sel = ".UWDnp";
const a_txt_sel = "._1MehU ._21MzE";

const story_line_sel = "._3sNGF._3j32v[data-test=stories-element] ._3jGFa._1e1GW._2lvkY";

function alert_msg(msg) {
    if (NOTIFY) alert(msg);
}

function confirm_msg(msg) {
    if (NOTIFY) {
        return confirm(msg);
    } else {
        return false;
    }
}

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

async function texts_sync_or_tsv(
    texts = [],
    tags = ["duolingo"],
    ask_continue = true)
{
    const server_ok = await is_ankiconnect_running();

    var msg = '';

    if (server_ok) {
        var n = await texts_sync_to_anki(texts);
        msg = n + " sentences were synced to Anki (already existing notes are skipped).\n\n";
    }

    var result = texts_to_tsv_uniq(texts);
    msg += "All extracted sentences in TSV format:\n```\n" + result + "\n```";

    if (ask_continue) {
        msg += "\n\nContinue?"
        const do_continue = confirm_msg(msg);

        if (do_continue) {
            // If on the review page, close the review modal
            if (document.querySelector(review_sel)) {
                const close_sel = "._1hEOp._13Rl7._3lUbm._18W4a.xtPuL .FrL-W[data-test=close-button]";
                timer_wait_for(close_sel, '', el => el.click(), 300, 10, true);
            }

            // Click the continue button
            var el = document.querySelector("button[data-test=player-next]");
            el.click();
        }
    } else {
        alert_msg(msg);
    }
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

    await texts_sync_or_tsv(texts, ["duolingo"], true);
}

async function click_review_reinit_timer(el) {
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
    timer_wait_for(learn_sel, "learn",
                    function(el) {
                        timer_wait_for(review_sel, "review lesson", click_review_reinit_timer, 300, 10, true);
                    },
                    300, 10, true);
}

async function collect_story_sentences() {
    if (DEBUG_LOG) console.log('collect_story_sentences()');

    var texts = [];

    const story_lines = document.querySelectorAll(story_line_sel);

    for (var i=0; i<story_lines.length; i++) {
        const q_txt = story_lines[i].innerText;
        // There are no translations in the story DOM.
        texts.push([q_txt, q_txt]);
    }

    await texts_sync_or_tsv(texts, ["duolingo", "translate_me"], false);
}

async function collect_translate_sentence() {
    if (DEBUG_LOG) console.log('collect_translate_sentence()');

    var texts = [];

    const q_txt_el = document.querySelector(tr_question_sel);
    const q_txt = q_txt_el.innerText;

    var a_txt_el = null;
    var a_txt = null;

    // correct
    if (!a_txt_el) {
        a_txt_el = document.querySelector(tr_answer_correct_text_sel);
        if (a_txt_el) {
            a_txt = a_txt_el.innerText;
        }
    }

    // incorrect
    if (!a_txt_el) {
        a_txt_el = document.querySelector(tr_answer_incorrect_text_sel);
        if (a_txt_el) {
            a_txt = a_txt_el.innerText;
        }
    }

    // use the word bank text
    if (!a_txt_el) {
        a_txt_el = document.querySelector(tr_answer_words_sel);
        if (a_txt_el) {
            a_txt = a_txt_el.innerText;
        }
    }

    // if answer was not found, show message
    if (!a_txt_el) {
        alert_msg("Answer was not found on the page.");
        return;
    }

    a_txt = a_txt
        .replace(/\n/g, ' ')
        .replace(/   +/g, ' ');

    // Question header
    const q_head = document.querySelector(tr_q_head_sel).innerText;

    const write_in_english = (q_head === 'Write this in English');
    const write_in_lang = (q_head.startsWith('Write this in'));

    if (write_in_english) {
        texts.push([a_txt, q_txt]);
    } else if (write_in_lang) {
        texts.push([q_txt, a_txt]);
    }

    await texts_sync_or_tsv(texts, ["duolingo"], true);
}

async function collect_type_the_translation() {
    if (DEBUG_LOG) console.log('collect_type_the_translation()');

    var texts = [];

    // the question (English)
    var q_txt_el = null;
    var q_txt = null;

    // incorrect
    if (!q_txt_el) {
        q_txt_el = document.querySelector(tr_answer_incorrect_text_sel);
        if (q_txt_el) {
            q_txt = q_txt_el.innerText;
        }
    }

    // correct, with typo or alt meaning
    if (!q_txt_el) {
        q_txt_el = document.querySelector(tr_answer_correct_text_sel);
        if (q_txt_el) {
            q_txt = q_txt_el.innerText;
        }
    }

    // correct, use the textarea
    if (!q_txt_el) {
        q_txt_el = document.querySelector(tr_answer_input_sel);
        if (q_txt_el) {
            q_txt = q_txt_el.value;
        }
    }

    if (!q_txt_el) {
        alert_msg("The question was not found on the page.");
        return;
    }

    // the answer (Italian, etc.) is at the top area

    var a_txt_el = document.querySelector(tr_question_sel);
    var a_txt = a_txt_el.innerText;

    // if answer was not found, show message
    if (!a_txt_el) {
        alert_msg("The answer was not found on the page.");
        return;
    }

    a_txt = a_txt
        .replace(/\n/g, ' ')
        .replace(/   +/g, ' ');

    texts.push([q_txt, a_txt]);

    await texts_sync_or_tsv(texts, ["duolingo"], true);
}

async function collect_type_the_missing() {
    if (DEBUG_LOG) console.log('collect_type_the_missing()');

    var texts = [];

    // the question (English)

    var q_txt_el = null;
    var q_txt = null;

    // incorrect
    if (!q_txt_el) {
        var a = document.querySelectorAll(tr_answer_incorrect_text_sel);
        if (a.length > 1) {
            q_txt_el = a[1];
        }
        if (q_txt_el) {
            q_txt = q_txt_el.innerText;
        }
    }

    // correct, with typo or alt meaning
    if (!q_txt_el) {
        var a = document.querySelectorAll(tr_answer_correct_text_sel);
        if (a.length > 1) {
            q_txt_el = a[1];
        }
        if (q_txt_el) {
            q_txt = q_txt_el.innerText;
        }
    }

    // correct
    if (!q_txt_el) {
        q_txt_el = document.querySelector(tr_answer_correct_text_sel);
        if (q_txt_el) {
            q_txt = q_txt_el.innerText;
        }
    }

    // NOTE: this causes a false warning for some reason
    if (!q_txt_el) {
        alert_msg("The question was not found on the page.");
        //return;
    }

    // the answer (Italian, etc.)

    var a_txt_el = null;
    var a_txt = null;

    // check incorrect first
    if (!a_txt_el) {
        var a = document.querySelectorAll(tr_answer_incorrect_text_sel);
        if (a.length > 1) {
            a_txt_el = a[0];
        }
        if (a_txt_el) {
            a_txt = a_txt_el.innerText;
        }
    }

    // correct, with typo or alt meaning
    if (!a_txt_el) {
        var a = document.querySelectorAll(tr_answer_correct_text_sel);
        if (a.length > 1) {
            a_txt_el = a[0];
        }
        if (a_txt_el) {
            a_txt = a_txt_el.innerText;
        }
    }

    // no match yet, use the input text
    if (!a_txt_el) {
        const spans = Array.from(document.querySelectorAll("label._3t3oQ._2FKqf._2ti2i > span"));

        const words = spans.map((i) => {
            if (i.getAttribute('class') == '_1bHqX') {
                var e = i.querySelector('input');
                return e.value;
            } else {
                return i.innerText;
            }
        });

        a_txt = words.join(' ');
    }

    if (a_txt == null || a_txt.length == 0) {
        alert_msg("The answer was not found on the page.");
        return;
    }

    a_txt = a_txt
        .replace(/\n/g, ' ')
        .replace(/   +/g, ' ')
        .replace(/ +([\?\!\.])/g, '$1');

    texts.push([q_txt, a_txt]);

    await texts_sync_or_tsv(texts, ["duolingo"], true);
}

async function collect_listen_tap() {
    if (DEBUG_LOG) console.log('collect_listen_tap()');

    var texts = [];

    // the question (English)

    var q_txt_el = null;
    var q_txt = null;

    // incorrect
    if (!q_txt_el) {
        var a = document.querySelectorAll(tr_answer_incorrect_text_sel);
        if (a.length > 1) {
            q_txt_el = a[1];
        }
        if (q_txt_el) {
            q_txt = q_txt_el.innerText;
        }
    }

    // correct, with typo or alt meaning
    if (!q_txt_el) {
        var a = document.querySelectorAll(tr_answer_correct_text_sel);
        if (a.length > 1) {
            q_txt_el = a[1];
        }
        if (q_txt_el) {
            q_txt = q_txt_el.innerText;
        }
    }

    // correct
    if (!q_txt_el) {
        q_txt_el = document.querySelector(tr_answer_correct_text_sel);
        if (q_txt_el) {
            q_txt = q_txt_el.innerText;
        }
    }

    if (!q_txt_el) {
        alert_msg("The question was not found on the page.");
        return;
    }

    // the answer (Italian, etc.)

    var a_txt_el = null;
    var a_txt = null;

    // check incorrect first
    if (!a_txt_el) {
        var a = document.querySelectorAll(tr_answer_incorrect_text_sel);
        if (a.length > 1) {
            a_txt_el = a[0];
        }
        if (a_txt_el) {
            a_txt = a_txt_el.innerText;
        }
    }

    // correct, with typo or alt meaning
    if (!a_txt_el) {
        var a = document.querySelectorAll(tr_answer_correct_text_sel);
        if (a.length > 1) {
            a_txt_el = a[0];
        }
        if (a_txt_el) {
            a_txt = a_txt_el.innerText;
        }
    }

    // use the word bank text
    if (!a_txt_el) {
        a_txt_el = document.querySelector(tr_answer_words_sel);
        if (a_txt_el) {
            a_txt = a_txt_el.innerText;
        }
    }

    if (a_txt == null || a_txt.length == 0) {
        alert_msg("The answer was not found on the page.");
        return;
    }

    a_txt = a_txt
        .replace(/\n/g, ' ')
        .replace(/   +/g, ' ');

    texts.push([q_txt, a_txt]);

    await texts_sync_or_tsv(texts, ["duolingo"], true);
}

async function collect_select_missing() {
    if (DEBUG_LOG) console.log('collect_select_missing()');

    var texts = [];

    // the question (English)

    var q_txt_el = null;
    var q_txt = null;

    // incorrect
    if (!q_txt_el) {
        var a = document.querySelectorAll(tr_answer_incorrect_text_sel);
        if (a.length > 1) {
            q_txt_el = a[1];
        }
        if (q_txt_el) {
            q_txt = q_txt_el.innerText;
        }
    }

    // correct
    if (!q_txt_el) {
        q_txt_el = document.querySelector(tr_answer_correct_text_sel);
        if (q_txt_el) {
            q_txt = q_txt_el.innerText;
        }
    }

    if (!q_txt_el) {
        alert_msg("The question was not found on the page.");
        return;
    }

    // the answer (Italian, etc.)

    var a_txt_el = null;
    var a_txt = null;

    // check incorrect first
    if (!a_txt_el) {
        var a = document.querySelectorAll(tr_answer_incorrect_text_sel);
        if (a.length > 1) {
            a_txt_el = a[0];
        }
        if (a_txt_el) {
            a_txt = a_txt_el.innerText;
        }
    }

    // correct, use the selected word choice
    if (!a_txt_el) {
        a_txt_el = document.querySelector("._3C_oC.disCS._2bJln._2-OmZ[data-test='challenge-choice'] div[data-test='challenge-judge-text']");
        if (a_txt_el) {
            a_txt = a_txt_el.innerText;
        }
    }

    if (a_txt == null || a_txt.length == 0) {
        alert_msg("The answer was not found on the page.");
        return;
    }

    // Answer is a word. Replace it in the exercise prompt.
    const prompt_el = document.querySelector("._2SfAl._2Hg6H");
    // data-prompt="Ho un'___ figlia, ma lei è più grande."
    var prompt_text = prompt_el.getAttribute('data-prompt');

    prompt_text = prompt_text.replace(/__+/, a_txt);
    a_txt = prompt_text;

    a_txt = a_txt
        .replace(/\n/g, ' ')
        .replace(/   +/g, ' ');

    texts.push([q_txt, a_txt]);

    await texts_sync_or_tsv(texts, ["duolingo"], true);
}

async function collect_sentence() {
    // if the solution is already checked
    if (document.querySelector(tr_blame_correct_sel) || document.querySelector(tr_blame_incorrect_sel)) {
        // type the missing word
        if (document.querySelector(type_missing_sel)) {
            await collect_type_the_missing();
            return true;
        }

        // tap what you hear
        if (document.querySelector(listen_tap_sel)) {
            await collect_listen_tap();
            return true;
        }

        // select the missing word
        if (document.querySelector(select_missing_sel)) {
            await collect_select_missing();
            return true;
        }

        // translate with textarea
        if (document.querySelector(tr_answer_input_sel)) {
            await collect_type_the_translation();
            return true;
        }

        // translate with word bank
        if (document.querySelector(tr_answer_words_sel)) {
            await collect_translate_sentence();
            return true;
        }

    }

    return false;
}

async function collect_sentence_reinit_timer(el) {
    await collect_sentence();

    var sel = null;
    if (el.getAttribute('data-test') == 'blame blame-correct') {
        sel = tr_blame_correct_sel;
    } else {
        sel = tr_blame_incorrect_sel;
    }

    // wait for the next check button
    timer_wait_for("button[data-test=player-next]", "check",
                    function(el) {
                        timer_wait_for(sel, "", collect_sentence_reinit_timer, 300, 10, true);
                    },
                    300, 10, true);
}

if (AUTO_SYNC) {
    timer_wait_for(tr_blame_correct_sel, "", collect_sentence_reinit_timer, 300, 10, true);
    timer_wait_for(tr_blame_incorrect_sel, "", collect_sentence_reinit_timer, 300, 10, true);
    timer_wait_for(review_sel, "review lesson", click_review_reinit_timer, 300, 10, true);
}

// Ctrl+Alt+L
// Cmd+Opt+L (Mac)
document.addEventListener('keydown', function(e) {
    if (e.key == 'l' && (e.ctrlKey || e.metaKey) && e.altKey) {
        // If there are review cards, collect them
        var c_el = selector_with_text(cards_sel);
        if (c_el) {
            collect_cards();
            return;
        }

        // Or click the Review Lesson button and collect cards
        var r_el = selector_with_text(review_sel, "review lesson");
        if (r_el) {
            click_review(r_el);
            return;
        }

        if (collect_sentence()) return;

        // Or collect story sentences
        collect_story_sentences();
    }
});

console.log(GM_info.script.name + ', v' + GM_info.script.version);
