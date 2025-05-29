
---

# ProtocolBench: Exploring and Benchmarking Communication Protocols for Microservices

**A repository to experiment with inter-service communication protocols — including SOME/IP, gRPC, REST (Feign), and
more.**

##  Project Overview

This repository serves as a sandbox environment to **explore, compare, and learn** about different communication
protocols used in distributed systems and microservice architectures. The primary focus is to **build multiple
independent microservices**, each exposing and consuming APIs using different protocols — to evaluate them in real-world
scenarios.

The project acts as a **hands-on learning platform** for developers to gain experience with:

* Designing and running microservices individually
* Implementing inter-service communication using various protocols
* Contributing to open-source projects by following structured workflows

---

## Project Goals

### 1. **Hands-on with Communication Protocols**

Build multiple REST-based microservices and integrate them using:

* **REST (Feign Clients)**
* **gRPC**
* **SOME/IP** *(targeted at automotive use cases)*
* **GraphQL** *(optional future scope)*

Each protocol will be used to implement the same business interaction patterns, making it easier to compare and contrast
them.

### 2. **Compare Protocols**

Evaluate and benchmark protocols in terms of:

* **Performance** (latency, throughput)
* **Developer experience** (ease of integration, tooling, learning curve)
* **Framework friendliness** (how well they integrate with Spring Boot)
* **Interoperability & Portability**
* **Resource usage**

### 3. **Open Source Development Workflow**

Follow best practices of open source software development:

* Create a new feature branch: `git checkout -b feature/<protocal>_<feature>`
* Make your changes and commit
* Open a Pull Request with proper description, reference to issues, and test coverage
* Participate in code review and merge discussions

The idea is to simulate how large-scale open source projects work and prepare contributors to meaningfully participate
in real-world OSS

> Our long-term goal is to evolve this into a well-documented reference repo that others can use to understand and
evaluate protocol choices for their own distributed systems.


---
## Getting Started

1. Clone the repo

   ```bash
   git clone https://github.com/Pujith/proto-calls.git
   ```

2. Setup Database - Postgres

    ```bash
    docker run --name my-postgres \
    -e POSTGRES_DB=protocallsdb \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -p 5432:5432 \
    -d postgres:15
       ```

3. Run individual services

   ```bash
   cd identityprovider
   mvn spring-boot:run
   ```

4.
---

## Comparison Metrics (To Be Added)

Once implementations and benchmarking are done, we will publish detailed comparison metrics including:

* Response time under load
* Serialization/deserialization overhead
* Ease of testing/mocking
* Dev tool support (e.g. Swagger for REST, Protobuf for gRPC)

---

## References

* [SOME/IP Protocol](https://www.embien.com/automotive-insights/some-ip-protocol-communication-a-comprehensive-guide)
* [gRPC.io](https://grpc.io)
* [Spring Cloud OpenFeign](https://docs.spring.io/spring-cloud-openfeign/docs/current/reference/html/)

---

