# Emerging Interfaces — Beyond the Screen

## The MIT Media Lab Tradition

The Media Lab was founded on a single question: "What does the world look like when the digital and physical are one?" Not "how do we make better screens?" but "how do we transcend screens entirely?"

### Tangible Bits (Hiroshi Ishii, 1997-present)
**Core insight:** The physical world is a rich interface that we've abandoned for glass rectangles. Tangible Bits seeks to bring physicality back to digital information.

**Three views of Tangible Bits:**
1. **Interactive surfaces:** Physical surfaces (walls, tables, desks) become active interfaces. Not screens mounted on walls — the SURFACE itself is the interface. Digital information lives IN physical space.
2. **Coupling of bits and atoms:** Physical objects represent and control digital information. Move a physical token → move digital data. Digital change → physical movement.
3. **Ambient media:** Information presented through background physical phenomena — light, sound, airflow, movement — that can be processed peripherally without focused attention.

**For us (KODA KENKŌ context):**
- Could physical tokens represent patient statuses in a clinical setting?
- Could ambient displays show ward-level information without screens?
- Could tangible controls reduce "screen fatigue" for doctors?

### Radical Atoms (Ishii, 2012-present)
The successor to Tangible Bits. Not just coupling physical to digital — making physical materials that CAN transform digitally. Programmable matter. Clay that reshapes under software control.

**Still research-stage, but the insight is:** The ultimate interface disappears into the material world. Not "no interface" (invisible UI is its own problem) — but "everything is interface."

### Wearable Computing (Mann, 1990s; Starner, 2000s)
The Media Lab pioneered wearables before Google Glass. Key insight: the body is the ultimate mobile platform.
- **Head-mounted displays:** Information always available, hands-free
- **Wrist-worn:** Glanceable, quick interactions (now mainstream: Apple Watch)
- **E-textiles:** Computing woven into clothing, sensors embedded in fabric

### Affective Computing (Picard, 1997)
Computers that recognize, interpret, and respond to human emotion.
- Emotion recognition from face, voice, physiology
- Emotion-sensitive interfaces that adapt to user state
- Ethical considerations: emotion manipulation, privacy, consent

**For KODA KENKŌ:** A clinical AI that can detect doctor frustration and offer help, or detect patient anxiety and adjust communication style.

### Social Robots (Breazeal, 2000s)
Robots designed for social interaction, not industrial tasks. Key insight: humans treat social robots as social entities, even knowing they're machines. We can't help it.

**Design implication:** Any interface that uses language, gesture, or eye contact will be treated socially. Design for this — not as a gimmick, but as a fundamental interaction paradigm.

---

## Ubiquitous Computing (Weiser, Xerox PARC, 1988-1991)

Mark Weiser's vision that founded ubiquitous computing:

**"The most profound technologies are those that disappear. They weave themselves into the fabric of everyday life until they are indistinguishable from it."**

### The Three Scales of Computing (Weiser, 1991)
1. **Tabs:** Inch-scale. Wearable, pocketable. Like Post-it notes made of computation.
2. **Pads:** Foot-scale. Scrap computers. Like paper — spreadable, annotatable, disposable.
3. **Boards:** Yard-scale. Wall displays. Shared, collaborative surfaces.

**The insight:** Computing should come in ALL sizes, not just the one in your pocket. And they should all work together seamlessly. This vision is partially realized (phones = tabs, tablets = pads, smart displays = boards) but the seamless interoperation remains unsolved.

### Calm Technology (Weiser & Seely Brown, 1995)
Technology that informs without demanding attention. Two design principles:
1. **Center:** What the user is focused on NOW. Demands attention.
2. **Periphery:** What the user can attend to without focus. Informs calmly.

**Examples:**
- A printer's gentle hum → working normally (periphery)
- A printer's silence → out of paper or jammed (moves from periphery to center)
- Inner office window: glance to see if someone's busy (periphery), versus knocking (center)

**For our products:**
- Status indicators that inform without interrupting
- Background awareness without foreground demands
- Information density control: user decides what's center vs. periphery

---

## Spatial Computing (Apple Vision Pro, Meta Quest, 2023-present)

### The Paradigm Shift
Not "a screen in front of your face" — that's VR. Spatial computing means digital content EXISTS in your physical space. It stays where you put it. It interacts with real-world objects. It respects physics.

### Design Principles for Spatial Interfaces
1. **Content is anchored to space, not screen.** A window on the left wall stays on the left wall when you turn around.
2. **Gaze + gesture > pointer.** Eyes are the cursor. Fingers are the click. Direct manipulation of digital objects as if they were physical.
3. **Passthrough is presence.** Seeing your real environment is not a "mode" — it's the default. Digital content augments reality, not replaces it.
4. **Depth is information.** Not just 2D grids with shadows — true 3D spatial organization. Things behind other things. Occlusion is a feature.
5. **Shared space, shared experience.** Multiple people see the same digital content in the same physical location.

### Novel UX Patterns
- **Volumetric windows:** Windows that exist at specific positions in 3D space
- **Diegetic UI:** Interface elements that exist "in the world" rather than overlaid
- **Eye tracking as input:** Gaze is faster than any pointer. Gaze + pinch = click.
- **Hand occlusion:** Hands appear IN FRONT of digital content. This matters for presence.
- **Spatial audio:** Sound comes from where the content is, not from headphones

---

## Conversational & Agent Interfaces

### The NEW Interaction Paradigm
The GUI (1984-present) is being joined by a second paradigm: conversation with AI agents. This is not a fad. It is as significant as the shift from command line to GUI.

### Design Principles for AI Interfaces
1. **Hybrid, not replacement.** GUI + conversation. Not conversation instead of GUI. The GUI is better for browsing, comparing, and spatial tasks. Conversation is better for commands, queries, and generation.
2. **Transparency, not magic.** Users should understand WHAT the AI can do, WHAT it just did, and WHY. Black-box AI creates learned helplessness.
3. **Initiative balance.** The AI should know when to lead (suggestions, warnings) and when to follow (commands, queries). Both extremes are bad: passive AI feels useless, aggressive AI feels intrusive.
4. **Graceful degradation.** When the AI is wrong (and it will be), the user must be able to recover. Undo. Correct. Override. The interface must make this easy.
5. **Memory that respects privacy.** AI that remembers you is more useful. AI that remembers everything without permission is creepy. Explicit memory controls.

### Patterns for AI Interfaces
- **Copilot panel:** Persistent AI assistant that sees context and offers help
- **Command palette with AI:** ⌘K that accepts natural language, not just commands
- **Inline generation:** AI generates content directly in the editing surface
- **Explanation overlays:** "Why did the AI do that?" → click for explanation
- **Confidence indicators:** High-confidence output vs. "this might be wrong"
- **Human handoff:** When the AI is out of its depth, transition to a human smoothly

---

## The Metaverse and Persistent Virtual Worlds

### Beyond Hype — What's Actually New
- **Persistence:** The world exists when you're not there. Changes accumulate.
- **Embodiment:** You have a body (avatar) that others can see. Body language matters.
- **Spatial continuity:** Walk from place to place. Architecture matters. Geography matters.
- **Co-presence:** Being with others in a space feels different from being on a video call.

### Design Lessons for ANY Interface
- **Space creates context:** Where something is communicates what it is
- **Persistence creates investment:** Things that last invite care and ownership
- **Embodiment creates presence:** Even a simple avatar changes interaction quality
- **Architecture is UX:** How spaces connect shapes behavior as much as UI does
