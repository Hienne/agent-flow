# stack-java

Java and Spring conventions for the flow plugin. Installing it pulls in `flow` (declared in `dependencies`).

- Skill `java-spring`: review and test checklist for Java and Spring Boot; `/flow:code-review` uses it in the Standards lane under the project's own conventions.

Enable it with `flow init --stack java`, or add `"stack-java@agentflow": true` to `enabledPlugins`.

## Build tools

The unit adapters live in the flow core and are chosen in `.flow/config.json` (`"units": { "adapters": ["maven"] }` or `["gradle"]`); `flow init` detects them.

| Adapter | Units | Verify command |
|---|---|---|
| `maven` | the `<module>` entries of the root `pom.xml`; a pom without modules is one unit | `mvn -q -pl <modules> -am verify`, `./mvnw` (`mvnw.cmd` on Windows) when the wrapper exists |
| `gradle` | the `include` entries of `settings.gradle(.kts)`; no includes means one unit | `./gradlew :<project>:check` (`gradlew.bat` on Windows), `gradle` without a wrapper |

A change to a root build file runs the whole build (`mvn -q verify`, `gradlew check`). `verify.targets` does not apply: Maven always runs `verify`, Gradle `check`. Code files for the review thresholds default to `.java`, `.kt`, `.kts`, `.xml` (`codeFiles` overrides them).

### Limits (v1)

- Maven: a flat reactor only. Modules of nested aggregator poms and modules listed only in profiles are not resolved separately; a change there is owned by the top-level module that contains it.
- Gradle: the default project layout only (`:a:b` is `a/b`). `projectDir` overrides, composite builds (`includeBuild`) and settings plugins that add projects are not read.
