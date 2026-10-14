# Presentation Design — Pitch Decks, Slides, Visual Documents

> *"If your slides would work as a wall of text in an email, you don't have slides — you have a document you're projecting."*

## The Presentation Design Mindset

Presentations are NOT documents. They are:
- **Visual accompaniment** to a human voice
- **Memory anchors** for key ideas
- **Emotional amplifiers** for your narrative

A great slide has ONE idea. One. If you need two slides, use two slides.

## Slide Architecture

### The 5-Second Rule
A slide must communicate its point within 5 seconds. If someone has to squint or read a paragraph, redesign it.

### One Idea Per Slide
```
❌ "Our platform combines AI-powered document intelligence 
    with industrial-grade security and Japanese compliance"

✅ Slide 1: "Documents become data" (big number + before/after)
   Slide 2: "Security by architecture" (diagram, not paragraph)
   Slide 3: "Built for Japanese regulation" (MHLW logo, check marks)
```

## Type Scale for Presentations

```
Display (title slide): 48-72px  — bold, maybe light
Section header:        32-40px  — bold, the slide's ONE idea
Body:                  18-24px  — regular, 2 lines max
Caption/label:         12-16px  — source, date, attribution
```

**Never go below 12px on screen.** If it doesn't fit at 12px, you have too much content — not too little space.

## Color in Presentations

### Background Rules
- **Dark room (conference):** Dark background (#1a1a1a, #0a0a1a, deep navy) with light text. White backgrounds blind people in dark rooms.
- **Bright room / virtual:** Light background (#ffffff) with dark text. Dark backgrounds look muddy on Zoom compression.
- **Printed deck:** Light background, no dark mode. Ink is expensive.

### Accent System
- One accent color. ONE.
- Use it for: key numbers, callout boxes, section dividers, CTA elements
- The accent should be your brand primary color
- Everything else: grayscale + one accent

### Data Visualization Color
- Positive trend: brand accent or dark (not green by default — green means "nature" in some contexts)
- Negative trend: brand accent at 40% opacity, or a defined comparison color
- Categories: use shades of brand color, not rainbow defaults

## Grid System

### Standard 16:9 (1920×1080)
```
Left margin:    120px (6.25%)
Right margin:   120px
Top margin:     80px
Bottom margin:  80px
Content area:   1680×920px
```

### Title slide: content centered vertically
### Content slide: content top-aligned, title at top-left
### Data slide: chart fills 70% of content area, labels outside

## Slide Types

### 1. Title Slide
- Company/product name (display size, bold)
- One-line descriptor underneath (body size, regular weight, muted)
- Date, presenter name (caption size, bottom)
- ONE distinctive visual element (brand pattern, photo, abstract shape — not stock)

### 2. Section Divider
- Section number + title
- Full-bleed brand color background OR dark background with accent element
- Nothing else

### 3. The Big Number
- One massive number (64-96px, bold or light)
- Label underneath (body size)
- Context in caption
- Use for: market size, results, timeframe, investment

### 4. Comparison Slide
- Left/right split or top/bottom split
- Clear labels: "Before" / "After", "Current" / "Proposed", "Competitor" / "SVITLA"
- Visual difference: gray vs brand color, muted vs vibrant

### 5. Diagram Slide
- One simplified diagram
- Remove every label that isn't essential to the narrative
- Animate build if complex (show one layer at a time)
- Use brand colors for the diagram, not default blues/oranges

### 6. Quote Slide
- One quote, large (24-32px)
- Attribution underneath
- Photo of the person (small, not full-bleed — this isn't a magazine)
- Use for: client validation, expert endorsement

### 7. The Closing Slide
- Repeat the ONE thing you want remembered
- Contact details
- Thank you (minimal — "Thank you" + logo, nothing more)

## Anti-Patterns (Never Do These)

### ❌ The Wall of Text
Three bullets max per slide. Each bullet ≤ 8 words. If your slide has full sentences, you've written a document.

### ❌ The Logo Farm
More than 6 client logos = they all blur together. Show 3-5 with names and roles.

### ❌ The Eye Chart
Tables with 10+ rows and 6+ columns. This is a handout, not a slide.

### ❌ The Stock Photo Hero
Generic diverse team pointing at whiteboard. Your audience has seen this 1,000 times. Use real photos or abstract brand graphics.

### ❌ The Build-Up to Nothing
Don't say "but first, some context" for 10 slides before getting to the point. Lead with the point.

### ❌ The Exported Spreadsheet
Don't screenshot Excel. Recreate the 3-4 most important numbers as a visual.

## Pitch Deck Structure (Investor)

For a 12-15 slide investor deck:

1. **Title** — Company name, one-line value prop, presenter
2. **Problem** — The pain, quantified. One sentence + one number
3. **Solution** — What you built. Show, don't tell
4. **Why Now** — Market timing. One trend, one stat
5. **Market** — TAM/SAM/SOM, visually
6. **Product** — Screenshots, not descriptions
7. **Traction** — Revenue, users, logos. Numbers only
8. **Business Model** — How you make money. Simple diagram
9. **Competition** — 2×2 matrix or comparison table (you in top-right)
10. **Team** — Photos, names, one relevant credential each
11. **Financials** — 3-year projection, key assumptions
12. **The Ask** — Amount, use of funds, milestone it buys
13. **Closing** — One memorable statement + contact

## Pitch Deck Structure (Client/Sales)

1. **Title** — Your company + client name
2. **Understanding** — "Here's what we heard" (prove you listened)
3. **The Opportunity** — What's possible
4. **Approach** — How we'd work together
5. **Evidence** — Similar work, results, relevant case study
6. **Team** — Who you'd work with
7. **Timeline** — Key milestones and deliverables
8. **Investment** — Price and what it includes
9. **Next Step** — Clear, single call to action

## Typography Rules

### Font Selection
- **Headings:** Sans-serif, bold or black weight. Not light (disappears on projectors).
- **Body:** Sans-serif, regular weight, 18-24px.
- **NEVER use serif for body text in presentations.** Serifs blur on projectors.
- **Monospace** for code or data only.

### Font Loading
- Use system fonts or properly embedded fonts
- Test on the actual presentation machine (different OS = different font rendering)
- Fallback: Arial (Windows), Helvetica (Mac), system-ui (web)

## Motion and Animation

### When to Use
- Revealing elements one at a time during a complex explanation
- Showing before/after transitions
- Demonstrating a product flow

### When NOT to Use
- Slide transitions (pick one, use it throughout)
- "Flying" bullets
- Spinning logos
- Anything that takes >0.5s

### The Rule
If the animation doesn't help them understand, it hurts them.

## Slide Deck as Handout

If the deck will be read without you presenting:
1. Add a one-line takeaway at the bottom of each slide
2. Add slide numbers (bottom right)
3. Add source citations (bottom left, caption size)
4. Include a one-page executive summary as slide 2

## Tools

- **Google Slides** — collaborative, web-based
- **Figma Slides** — design-quality, component-based
- **Keynote** — best rendering, best typography on Mac
- **PowerPoint** — ubiquitous, most compatible
- **Reveal.js / Slidev** — code-driven, developer-friendly
- **Canva** — fast, template-heavy (use cautiously — templates are the new stock photos)

## Design QA Checklist for Presentations

Before the deck leaves your hands:

- [ ] Every slide passes the 5-second test
- [ ] No slide has more than 3 bullets
- [ ] No bullet has more than 8 words
- [ ] Type hierarchy is consistent (same sizes used in same roles)
- [ ] One accent color throughout
- [ ] All charts have labels (axes, units, sources)
- [ ] All images are high-res (not pixelated when projected)
- [ ] Fonts are embedded or system-safe
- [ ] Slide numbers present
- [ ] No lorem ipsum or placeholder text
- [ ] Company logo on every slide (small, consistent position)
- [ ] Tested on the actual projector/screen resolution
- [ ] A human who doesn't know the content understood the deck in one pass

## The Ultimate Presentation Test

Send the deck to someone who knows nothing about the topic. Ask them:
1. What is this about? (Should be obvious from slide 2)
2. What's the most important number? (Should recall one)
3. What should happen next? (Should know the CTA)

If they hesitate on any of these, redesign.

---

*"A presentation is not a document you read. It's a visual experience you orchestrate."*
