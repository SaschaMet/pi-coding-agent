# Sales psychology audit: Praxiswebsite mit KI-Begleitung für Heilpraktikerinnen

- URL: `http://localhost:4321/lp/praxiswebsite-begleitet`, fetched with Playwright via `host.docker.internal` (fetch tool refused: `robots.txt` disallows `/lp/`). Viewport 1280×720.
- Not seen: both images are served from `localhost:1337` and did not load in the audit browser. Copy, structure, and alt texts were audited; visuals were not.
- Date: 2026-11-07 · Basis: motive-based audit after Niggehoff's published principles (not Neuroprofiling).

## Buyer motive

Dominant: **green, Harmonie & Geborgenheit** (hypothesis) · secondary: **blue, Ordnung & Stabilität** (hypothesis)

Evidence (the page's own picture of the buyer):
- "Du willst Menschen behandeln. Nicht Websites bauen." (a helping profession, people before tech)
- "… und warum du das Wort „Marketing" nicht magst." (selling feels like pressure)
- "Ich kann nichts mit Technik. Schaffe ich das?" (needs reassurance and guidance)
- "Darf ich als Heilpraktikerin überhaupt werben?" and "Warum deutsche Server?" (blue: rules, data safety)

Current copy serves: green and blue in the body (warm "du", no-blame lines, refund, step-by-step, HWG, German servers). → Gap: the main call to action and one section speak red: "Launchpreis sichern" (5×, including the first screen) and the loss math "kostet dich trotzdem jeden Monat etwas". Both are pressure, which repels green.

## Scores

Anchors: 0 = missing or against the motive · 1 = present but buried, said once, or mixed with a clash · 2 = prominent and fits.

| # | Lens | Score | Evidence | Note |
| --- | --- | --- | --- | --- |
| 1 | Motive fit | 1 | Fits: "Das lag nicht an dir. Es lag daran, dass dir niemand gesagt hat, was als Nächstes dran ist." Clashes: "Die Seite, die seit Monaten auf deiner Liste steht, kostet dich trotzdem jeden Monat etwas, solange sie dort steht." | Tone is right throughout; the clash sits in the CTA (first screen) and the loss section. |
| 2 | Comparability | 1 | H1 "FÜR HEILPRAKTIKERINNEN FÜR PSYCHOTHERAPIE MIT EIGENER PRAXIS"; first sentence "Du willst Menschen behandeln. Nicht Websites bauen." | The niche is named, but any website provider for therapists could say both lines. The real differentiator, a Heilpraktiker für Psychotherapie who built shops for 13 years, is not on the first screen. |
| 3 | Hook | 1 | "Du willst Menschen behandeln. Nicht Websites bauen." | Strong and memorable, but said once. The close only paraphrases it: "Und du machst wieder das, wofür du die Praxis eröffnet hast." |
| 4 | Motives over features | 1 | "Leitfaden 4 · Online stellen: Deine Seite auf deutschen Servern, unter deiner Adresse, mit eigener E-Mail-Adresse"; "Leitfaden 5 · Gefunden werden: Google-Unternehmensprofil, Einträge in den Verzeichnissen deiner Berufsgruppe, Seitentitel und Beschreibungen für die Suche"; "Leitfaden 3 · Design: Ein Entwurf deiner Website, den du im Browser siehst und per Gespräch änderst" | Stage names are outcomes ("Verstanden werden / Gefunden werden / Gebucht werden"); the deliverable lines under them and the hero subline ("im Gespräch mit einer KI … auf deutschen Servern") describe the mechanism. |
| 5 | Specificity | 2 | Specific: "199 € netto zum Launch, danach 250 €", "14 Tage Geld zurück", "etwa 90 Minuten", "13 Jahre Online-Shops für Unternehmen wie REWE und E.ON". Vague (4): "WENIGE STUNDEN, VERTEILT AUF DEINE ABENDE", "In ein paar Wochen ist die Website von deiner Liste", "Die Leitfäden sind aus Gesprächen mit Heilpraktikerinnen entstanden", "Die KI kann die meisten Fragen beantworten." | Price and refund are exact and repeated. The one vague claim on the first screen is the time promise. Page placeholders excluded (see Draft gaps). |
| 6 | Proof first | 1 | "Ich bin Sascha Metzger, Heilpraktiker für Psychotherapie. … Davor habe ich 13 Jahre Online-Shops für Unternehmen wie REWE und E.ON gebaut." | Strongest proof for both motives (insider for green, credentials for blue), but in the 4th section, about 5.5 screens down. The portrait there has an empty alt text. No buyer voices yet, which is honest for a new product. |
| 7 | Framing | 0 | CTAs: "Launchpreis sichern" (header, hero, after bio, price box, final form), "Text kopieren", "Lieber erst reden? Erstgespräch anfragen". Offer names: "das Paket", "Sechs Gesprächsleitfäden". | The main CTA names a discount and implies grabbing something before it's gone, while the action is a no-payment sign-up ("Vorher zahlst du nichts."). It says nothing about what she gets, and its pressure works against green. "Lieber erst reden?" is a good green frame, but it's secondary. |
| 8 | Named method | 1 | "01 Verstanden werden · 02 Gefunden werden · 03 Gebucht werden"; names used: "Der Weg", "das Paket", "Sechs Gesprächsleitfäden", title "Praxiswebsite mit KI-Begleitung" | Steps are visible, numbered, and repeated (also in the hero image alt). The offer has four names and no single one. |

Total 8/16. Re-check run because six lenses shared score 1: each was compared against the anchors and held (lens 1 has a first-screen clash, lenses 2/4/8 are mixed, lens 3 is said once, lens 6 is buried).

## Keep

- "Du willst Menschen behandeln. Nicht Websites bauen." — the hook. It names her identity, not a product. Build on it; don't replace it.
- "Das lag nicht an dir. Es lag daran, dass dir niemand gesagt hat, was als Nächstes dran ist." — removes shame, which is the strongest green line on the page.
- "Ich weiß, wie ein Erstgespräch läuft, was das Heilmittelwerbegesetz erlaubt und warum du das Wort „Marketing" nicht magst." — being understood (green) plus competence (blue) in one sentence.
- "Du zahlst erst, wenn das Paket da ist." / "… schreibst du mir eine Mail, ohne Begründung." — risk removed with no pressure, ideal for green and blue.
- "Ein erfundenes Beispiel, keine Kundin." — honesty about the example earns blue trust, and the before/after table gives yellow a vivid picture.
- "Lieber erst reden? Erstgespräch anfragen" — the right low-pressure door for green buyers.

## Recommendations

### 1. Frame the main CTA as what she gets, not as a discount to grab (lens 7, impact high, effort S)
Principle: Framing
Before: "Launchpreis sichern →"
After (header, hero, after bio): "Vormerken, ohne zu zahlen →"
After (final form, echoing the H2 above it): "Die Website von meiner Liste holen →"
Keep the price where it belongs, in the price box: "Zum Launchpreis vormerken: 199 € statt 250 €"
Why: a green buyer who dislikes "Marketing" reads "sichern" as pressure. The new label says what happens (a no-cost sign-up), which matches "Vorher zahlst du nichts."
Check: A/B test hero CTA click rate (see cro-methodology); 5-second test: "What happens when you click?" → answer "I sign up, I don't pay yet."

### 2. Put the person and the proof on the first screen (lens 6, impact high, effort S)
Principle: Proof before explanation
Before (first screen, under the hook): "Eine Seite wie diese entsteht im Gespräch mit einer KI, …" (the proof sits ~5.5 screens down)
After (one line plus a small portrait under the hook): "Von Sascha Metzger, Heilpraktiker für Psychotherapie – und davor 13 Jahre Online-Shops für REWE und E.ON."
Portrait alt text: "Sascha Metzger, Heilpraktiker für Psychotherapie"
Why: green needs a face and someone who understands her world; blue needs the credential. Today both are below the fold.
Check: 5-second test: "Who is behind this offer, and why trust him?" → names the profession and the shop background.

### 3. Turn the loss math into her own gain calculation (lens 1, impact high, effort S)
Principle: Influence, not manipulation (green: "Repels it: pushy urgency")
Before (H2): "Eine freie Stunde pro Woche kostet dich mehr als dieses Paket"
Before (text): "Die Seite, die seit Monaten auf deiner Liste steht, kostet dich trotzdem jeden Monat etwas, solange sie dort steht."
After (H2): "Eine Stunde mehr pro Woche, die gebucht wird"
After (text): "Rechne mit deinem eigenen Satz: Bei 100 € pro Sitzung sind das rund 5.000 € im Jahr. Das Paket kostet einmal 199 € netto. Und der erste Schritt ist klein: der Leitfaden zur Positionierung, etwa 90 Minuten an einem Abend."
Why: same argument, gain frame instead of guilt. Green buyers keep reading instead of pulling back.
Check: ask 3 Heilpraktikerinnen "How does this section feel?"; A/B test scroll-past rate.

### 4. Make the hero true only for this offer (lens 2, impact high, effort M)
Principle: Out of comparability
Before: "Eine Seite wie diese entsteht im Gespräch mit einer KI, die dich Frage für Frage von der Positionierung über die Texte bis zur fertigen Website auf deutschen Servern führt."
After: "Eine KI stellt dir die Fragen, die ich als Heilpraktiker für Psychotherapie auch stellen würde. Aus deinen Antworten entstehen Texte, geprüft auf die Regeln des Heilmittelwerbegesetzes, und eine Website auf deutschen Servern, die dir gehört."
Why: a therapist's questions, the HWG check, and owning your site is a combination no agency or site builder can claim. It serves green (understood) and blue (safe) at once.
Check: logo-swap test against 3 providers of Heilpraktiker websites. The sentence must be false for each of them.

### 5. Repeat the hook at the close and in the price box (lens 3, impact medium, effort S)
Principle: Signature Framing and hooks
Before (close): "Und du machst wieder das, wofür du die Praxis eröffnet hast."
After (close): "Du willst Menschen behandeln, nicht Websites bauen. Danach musst du es auch nicht mehr."
After (price box, above "199 €"): "Menschen behandeln statt Websites bauen."
Why: a hook only works when it's repeated. Said once, it's just a good line.
Check: ask a test reader a day later what the page promised; the answer should contain the hook.

### 6. Give the offer one name (lens 8, impact medium, effort S)
Principle: Own method
Before: "Der Weg" / "das Paket" / "Sechs Gesprächsleitfäden" / "Praxiswebsite mit KI-Begleitung"
After: "[Platzhalter: ein Name, z. B. „Der Praxiswebsite-Weg"] – Verstanden. Gefunden. Gebucht. In sechs Gesprächen." Use that name everywhere, including the page title and the price-box heading.
Why: a named method can't be compared like-for-like, and blue buyers remember structure with a name.
Check: count distinct offer names on the page → 1.

### 7. Make the first-screen time promise and the origin claim exact (lens 5, impact medium, effort S)
Principle: Specificity
Before: "WENIGE STUNDEN, VERTEILT AUF DEINE ABENDE"
After: "[Platzhalter: Anzahl] STUNDEN, VERTEILT AUF DEINE ABENDE"
Before: "Die Leitfäden sind aus Gesprächen mit Heilpraktikerinnen entstanden, …"
After: "Die Leitfäden sind aus Gesprächen mit [Platzhalter: Anzahl] Heilpraktikerinnen entstanden, …"
Why: "wenige" is the only vague claim on the first screen, and blue buyers distrust vague time promises.
Check: vague claims on the first screen → 0.

### 8. Rewrite the deliverable lines as what she gets (lens 4, impact medium, effort M)
Principle: Motives over features (the B2B ego trap)
Before: "Leitfaden 4 · Online stellen: Deine Seite auf deutschen Servern, unter deiner Adresse, mit eigener E-Mail-Adresse"
After: "Leitfaden 4 · Online stellen: Deine Seite ist online, unter deiner eigenen Adresse, und Anfragen kommen in dein Postfach praxis@deine-adresse.de. Auf deutschen Servern, damit du niemandem eine Übermittlung in die USA erklären musst."
Before: "Leitfaden 5 · Gefunden werden: Google-Unternehmensprofil, Einträge in den Verzeichnissen deiner Berufsgruppe, Seitentitel und Beschreibungen für die Suche"
After: "Leitfaden 5 · Gefunden werden: Damit dich findet, wer in deiner Stadt nach Hilfe sucht: dein Google-Unternehmensprofil, die Verzeichnisse deiner Berufsgruppe und Seitentitel, die sagen, wobei du hilfst."
Why: each line now answers "so what?" for her. The second one is phrased as a goal, not a ranking promise.
Check: read each line aloud and ask "so what?". If the line doesn't already answer it, rewrite it.

### 9. Add one buyer voice next to the headline once the first buyers exist (lens 6, impact medium, effort M)
Principle: Proof before explanation (green: "testimonials in the client's voice")
Before: none (honestly none yet)
After: "„[Platzhalter: Zitat einer Launch-Käuferin, mit Einwilligung]" – [Platzhalter: Vorname], Heilpraktikerin für Psychotherapie, [Platzhalter: Ort]"
Why: green buyers trust colleagues more than the seller. Pick at most 3 voices, never a wall.
Check: present before any paid traffic goes to the page.

## Draft gaps

Left out of all scores and recommendations. Fill these before launch:
- `[Dauer]` ×3 (Texte; Gefunden werden; Gebucht werden)
- `[Gesamtdauer Technik]` ×2 (technology section, FAQ)
- `[Minuten]` ×2 (Gebucht werden, FAQ)
- `[Betrag]` ×5 (4 rows of the cost table, the support hour)
- `[Launchdatum]` ×3 (price box, "Was nach der Eintragung passiert", form footnote)

## Human to-dos (placeholders to fill, claims to verify)

- Fill the placeholders from recommendations 6, 7, and 9: the offer name, the number of hours, the number of Heilpraktikerinnen interviewed, and buyer quotes with written consent.
- Check the new copy against UWG and HWG before publishing. The HWG-check claim in recommendation 4 and the 5,000 € example in recommendation 3 need this most (see influence-psychology).
- Look at the visuals yourself. The hero image and the portrait did not load in the audit browser.
- Test recommendations 1 and 3 as A/B tests rather than shipping blind (see cro-methodology).
