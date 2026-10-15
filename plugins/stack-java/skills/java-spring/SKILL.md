---
name: java-spring
description: Java and Spring Boot review and test conventions. Use when writing, reviewing or testing Java or Kotlin code in a Maven or Gradle project, including inside /flow:code-review and the flow:code-reviewer agent; the project's own written conventions outrank this checklist.
---

# Java and Spring conventions

A checklist for the Standards lane of `/flow:code-review` and for writing code. It names the stack-wide rules; a convention the project lists in `flow explain` wins over any item here. Report a breach with the file and line, the rule, and the fix.

## Design and wiring

- Constructor injection with `final` fields. No field injection (`@Autowired` on a field) and no setter injection outside optional dependencies.
- One responsibility per bean. A controller maps HTTP to a service call and back; business rules live in the service; persistence lives in a repository.
- Configuration goes through `@ConfigurationProperties` classes with validation, not scattered `@Value` strings. No secrets or environment URLs in source or `application.yml` defaults.
- Prefer immutable value types (`record`, or final fields with no setters) for DTOs and commands. Do not expose JPA entities from a controller.

## Transactions and persistence

- `@Transactional` sits on public service methods. A call to a `@Transactional` method from the same class bypasses the proxy and runs without the transaction: flag it.
- Read-only queries use `@Transactional(readOnly = true)`. No remote call (HTTP, message broker) inside an open database transaction unless the spec asks for it.
- Watch for N+1 queries: a lazy association read in a loop or in a mapper needs a fetch join, an entity graph or a dedicated query.
- Schema changes go through the project's migration tool (Flyway or Liquibase), never `ddl-auto` outside local profiles.

## Errors, nulls and validation

- Request bodies and parameters carry Bean Validation (`@Valid`, `@NotNull`, `@Size`); the controller does not re-check what validation already guarantees.
- Errors map to responses in one `@RestControllerAdvice`; services throw domain exceptions, not `ResponseStatusException`.
- Never catch `Exception` or `Throwable` to log and continue; never swallow an exception without a comment saying why.
- `Optional` is a return type only: not a field, parameter or collection element. Do not call `get()` without a check; use `orElseThrow`.
- Logs use parameterised messages (`log.info("x {}", id)`), never string concatenation, and never contain secrets, tokens or personal data.

## Concurrency and resources

- Close streams, clients and connections with try-with-resources.
- Shared mutable state in a singleton bean is a defect unless it is thread-safe by design; name the race.
- `@Async` and scheduled methods need an explicit executor and error handling.

## Tests

- JUnit 5 and AssertJ. One behaviour per test, named for the behaviour (`rejectsTransferAboveLimit`), with given/when/then structure.
- Use the narrowest Spring slice that proves the behaviour: plain unit tests for services, `@WebMvcTest` for controllers, `@DataJpaTest` for repositories. `@SpringBootTest` only for a real end-to-end path.
- Mock collaborators at the boundary (repositories, clients), not the class under test. No `Thread.sleep`; use Awaitility for asynchronous results.
- Database integration tests run against the real engine (Testcontainers) when the query relies on engine behaviour.
- Test what the spec's acceptance criteria name; do not add tests for impossible inputs.

## Verification

`flow verify` runs the unit commands: Maven `mvn -q -pl <modules> -am verify` (`./mvnw` when the wrapper exists), Gradle `gradlew :<project>:check`. A change to the root `pom.xml`, `settings.gradle(.kts)`, root `build.gradle(.kts)`, `gradle.properties` or `gradle/libs.versions.toml` verifies the whole build.
