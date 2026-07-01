# Cloud Claude

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

## Design System
Always read `DESIGN.md` before any visual or UI decision. The **"Personal OS App
Language"** section (near the end) is the source of truth for this app — fonts (SF Pro +
SF Mono), colors (dark-first, single Action Blue accent), grouped-list/tab-bar HIG layout,
activity-card / day-view / reflection-composer patterns, and the `~` estimate affordance.
The earlier sections are Apple *marketing* language and must NOT be applied literally to the
app. Do not deviate without explicit user approval; in QA, flag code that doesn't match.
