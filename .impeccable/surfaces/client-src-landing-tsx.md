---
version: 1
slug: "client-src-landing-tsx"
primary_target: "client/src/Landing.tsx"
related_targets: []
---

Mode: Persuade
Seed: seed:7394bbce7b67f254 (assigned, kept by user)

THESIS: One synthetic dispute record etched into a pane of smoked glass. The merchant reads it from one side, the buyer from the other, and the facts are the same lines.

OWN-WORLD: Smoked glass, laser etch, refraction. Palette #dfe6e3 (mist ground), #10181b (smoke ink), #e9a23b (merchant amber), #5aa9d8 (buyer blue), #d8f65a (etch highlight, used sparingly). Strict square unit grid (one --u unit) under every section. No purple gradients, glowing cards, floating blobs or neon-on-black.

STORY: 1 Hero: the pane, sign-in on its frame. 2 How it works: one scroll crank turns the pane and steps the dispute through four stages (opened, evidence, response drafted, person reviews), with a plain text step list beside it. 3 Two sides: the merchant reading and buyer reading of the same record. 4 Safeguards: present etched, missing dashed, contradictory cracked; nothing submitted automatically. 5 FAQ. 6 Close: sign in.

FIRST VIEWPORT: Headline + one plain sentence + Sign in button at left; the glass pane at right holding a full-size, legible synthetic record (labelled illustrative/synthetic), tilted slightly, amber edge.

SIGNATURE INTERACTION: A single GSAP ScrollTrigger timeline scrubbed by scroll turns the pane (rotateY) from amber merchant side to blue buyer side and advances the stage marker. A side toggle (Merchant / Buyer) does the same on click/keyboard. Reduced motion: no rotation, instant swap, stage list carries the story.

ADAPTATIONS: The scrub does not advance the dispute's stage. All four DisputeDesk steps happen inside the dispute's stage 2 (Seller and buyer respond), so moving the stage would misstate the product; the step numbers carry the marker. The "crank" is the scroll, not a metaphor on the page: the How heading uses the product's own words. Lime is limited to the present check, selection, the logo glyph and focus rings; calls to action are ink on mist, or mist on ink and on glass.

1024–1279 keeps the pane below the copy: at that width the side-by-side split breaks the h1 into five lines; the split and the resting tilt start at 1280. Frost grain is drawn in CSS (layered gradients) rather than an SVG asset, so no new public file is added.

RISKS: Glass reading as decoration if the record is not legible. Keep record text full size and AA contrast on the pane in both themes. CSP: no inline style attributes; GSAP writes via CSSOM only. No invented facts: the record is synthetic and labelled.
