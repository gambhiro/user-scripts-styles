// ==UserScript==
// @name         Duolingo: Hide spoken text
// @description  Hide the text in Duolingo translation challenges and stories, to train hearing comprehension. Add Shift-Space keybinding to repeat the audio.
// @version      1.0.0
// @author       gambhiro
// @license      unlicense
// @match        https://www.duolingo.com/*
// @namespace    Violentmonkey Scripts
// @grant        GM_addStyle
// @inject-into  content
// @homepageURL  https://github.com/gambhiro/user-scripts-styles
// @downloadURL  https://github.com/gambhiro/user-scripts-styles/raw/main/duolingo-hide-spoken-text.user.js
// ==/UserScript==

// Detect Darklingo++
// NOTE: This method is not reliable.
// const body_bg = window.getComputedStyle( document.body ,null).getPropertyValue('background-color');
// const DARK_MODE = (body_bg == "rgb(32, 32, 32)");

const DARK_MODE = true;

const text_color = (DARK_MODE) ? "#eee" : "#111";

// Hide spoken text in translation challenges
GM_addStyle(`
div[data-test="challenge challenge-translate"] label + span { color: transparent; }

.unblur,
div[data-test="challenge challenge-translate"] label + span:hover { color: ${text_color} !important; }
`);

// Hide text in stories

/// The outer-most CSS class of the Speech Bubbles
const speech_bubble = "_3jGFa";

/// The text inside a speech bubble
const synced_text = "_2igzU";
const highlighted = "_3Curv";

const audio_button_sel = "._3xGhq[data-test=audio-button]";

const bubble_color = "transparent";
const bubble_hover_color = (DARK_MODE) ? "#eee" : "#111";

// Hide the text in the speech bubble
// unless the user hovers over it

GM_addStyle(`
  .${speech_bubble}:not(:hover) {
    color: ${bubble_color} !important;
    background-color: ${bubble_color} !important;
  }

  .${speech_bubble}:hover {
    color: ${bubble_hover_color} !important;
  }
`);

// Force the child text to use the same text color as the bubble container
// (synchronized with the hover state)

GM_addStyle(`
  .${synced_text}.${highlighted} {
    color: inherit !important
  }

  .${synced_text} {
    color: inherit !important
  }
`);

// Disable the speech bubble arrow, because it doesn't synchronize its
// background color with the rest of the bubble's hover state

GM_addStyle(`
  .${speech_bubble}::before {
    border-bottom: 0px;
    border-right: 0px;
    border-top-left-radius: 0%;
    content: '';
    left: 0px;
    position: absolute;
    top: 0px;
  }

  .${speech_bubble}::after {
    border-bottom: 0px;
    border-right: 0px;
    content: '';
    left: 0px;
    position: absolute;
    top: 0px;
  }
`);

// Set keybinding to Shift-Space to repeat the audio

function handle_keyboard(e) {
    if (e.code === "Space" && e.shiftKey) {
        e.preventDefault();

        // Play button in translation challenges
        const speakerButtonSelector = 'label.sgs9X button, [data-test="speaker-button"]';
        const speakButton = document.querySelector(speakerButtonSelector);
        if (speakButton) {
            speakButton.click();
        }

        // Play button in stories
        var visiblePlayButtons = Array.from(
            document.querySelectorAll(audio_button_sel))
            .filter(button => button.offsetParent !== null);

        if (visiblePlayButtons.length > 0) {
            var playButton = visiblePlayButtons[visiblePlayButtons.length - 1]
            playButton.click()
        }
    }
}

//document.addEventListener('keypress', handle_keyboard, false);
document.addEventListener('keyup', handle_keyboard, false);
