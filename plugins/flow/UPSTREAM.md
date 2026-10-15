# Upstream of the flow skills

The workflow skills in `skills/` are forks. This table records where each came from, so a later upstream change can be compared and merged by hand. The skills installer records a folder hash rather than a commit for most entries; compare against the upstream folder content with that hash.

| Skill | Upstream | Path | Version | Local changes |
|---|---|---|---|---|
| code-review | — | — | — | Written for flow: Standards and Spec lanes over the project conventions (the upstream `code-review` of github.com/mattpocock/skills is not used). |
| code-simplification | — | — | — | Written for flow: behaviour-preserving simplification, report and apply modes. |
| codebase-design | github.com/mattpocock/skills | skills/engineering/codebase-design | folder hash fb1d8ab98ad15155 | Unchanged apart from removed host-specific agent files. |
| diagnosing-bugs | github.com/mattpocock/skills | skills/engineering/diagnosing-bugs | folder hash ed5cbc42b8ef8313 | Unchanged apart from removed host-specific agent files. |
| domain-modeling | github.com/mattpocock/skills | skills/engineering/domain-modeling | folder hash f377a1341e1b3688 | Unchanged apart from removed host-specific agent files. |
| grill-with-docs | github.com/mattpocock/skills | skills/engineering/grill-with-docs | folder hash a610223c9796f755 | Reads the flow workflow profile; domain docs via `flow explain`; records `decisions.md`. |
| grilling | github.com/mattpocock/skills | skills/productivity/grilling | folder hash 4fa026e597977034 | Unchanged apart from removed host-specific agent files. |
| html-plan | github.com/anthropics/claude-plugins-community (MIT, Thariq Shihipar) | html-plan/skills/html-plan | commit f60f0454df3045f724c43c6346ec80bdcc3472b2 | Unchanged except `/flow:html-plan` and the plugin-root pack path. |
| implement | github.com/mattpocock/skills | skills/engineering/implement | folder hash 057512282695d357 | Runs the flow task lifecycle (`flow task start`, `flow verify`, review gate, `--full`, report). |
| improve-codebase-architecture | github.com/mattpocock/skills | skills/engineering/improve-codebase-architecture | folder hash f74b0bf1be26220d | Skill references namespaced as `/flow:*`. |
| overengineering-review | — | — | — | Local skill, no public upstream recorded. |
| prototype | github.com/mattpocock/skills | skills/engineering/prototype | folder hash 62979fe039ef6440 | Unchanged apart from removed host-specific agent files. |
| research | github.com/mattpocock/skills | skills/engineering/research | folder hash 2c8b768d5f0309ea | Unchanged apart from removed host-specific agent files. |
| tdd | github.com/mattpocock/skills | skills/engineering/tdd | folder hash 0c09a435ba032b15 | Unchanged apart from removed host-specific agent files. |
| to-spec | github.com/mattpocock/skills | skills/engineering/to-spec | folder hash 0ee8caf20fc7df94 | Writes `spec.md` per the flow artifact contract and an html-plan review page. |
| to-tickets | github.com/mattpocock/skills | skills/engineering/to-tickets | folder hash f7d1bca83f85e488 | Writes tickets and `issues/index.md` per the flow artifact contract. |
| write-a-skill | — | — | — | Local copy, no public upstream recorded. |
| writing-for-agents | github.com/mattpocock/skills | skills/productivity/writing-for-agents | folder hash 831e996c177c6c52 | Unchanged apart from removed host-specific agent files. |
