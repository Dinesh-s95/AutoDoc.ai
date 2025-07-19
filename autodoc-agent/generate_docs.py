
#v3
import json
from pathlib import Path
from openai import OpenAI

# Initialize OpenAI client
client = OpenAI()

# File paths
SUMMARY_FILE = Path("./target/generated-docs/classes-summary.json")
markdown_file = Path("./target/generated-docs.md")
plantuml_file = Path("./target/architecture-diagram.puml")


# -----------------------------
def call_gpt(prompt, model="gpt-4", temperature=0.7):
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
    )
    return response.choices[0].message.content.strip()


# -----------------------------
def load_summary():
    if not SUMMARY_FILE.exists():
        print("❌ Input summary not found.")
        return []
    with open(SUMMARY_FILE, "r") as f:
        return json.load(f)


# -----------------------------
def generate_project_intro(summaries):
    prompt = f"""
You are a senior software architect. Based on the following list of Java classes (names, annotations, fields, methods), provide a brief but insightful overview of what the overall microservice does.

Don't describe the classes one by one yet.

Focus on:
- What functionality this microservice offers
- What kind of external systems it might talk to (e.g., OAuth, DB, Kafka, REST)
- What its general responsibilities are (e.g., auth, data sync, user management)

Classes JSON:
{json.dumps(summaries, indent=2)}

Respond in 2-3 short paragraphs in Markdown.
"""
    return call_gpt(prompt)


# -----------------------------
def generate_architecture_diagram(class_summaries):
    prompt = f"""
You are a software architect. Based on the following list of Java classes, their annotations, methods, and fields, generate a high-level architecture diagram using PlantUML code.

Objective:
- Group classes logically (e.g., Controller, Service, Repository, Entity, Config, Security)
- Use PlantUML `package` blocks and arrows to indicate dependencies
- Keep diagram clean and readable
- Only meaningful relationships should be shown

Return ONLY PlantUML code inside ```plantuml block.

Classes:
{json.dumps(class_summaries, indent=2)}
"""
    try:
        return call_gpt(prompt)
    except Exception as e:
        print(f"❌ Failed to generate architecture diagram: {e}")
        return ""


# -----------------------------
def generate_class_explanation(cls, all_classes, architecture_puml):
    class_name = cls.get("className")
    prompt = f"""
You are an expert Java and Spring Boot software engineer.

Given:
1. This Java class summary:
{json.dumps(cls, indent=2)}

2. All other classes in the microservice:
{json.dumps(all_classes, indent=2)}

3. The architecture diagram in PlantUML (showing relationships):
{architecture_puml}

➡️ Analyze this class in the context of the entire system.

Explain:
- What this class is responsible for in this microservice
- How it's connected to other classes (based on method calls, fields, layers, etc.)
- What services or layers depend on it
- If it plays any special role (e.g., Entity, Service, AuthProvider, Controller, Utility, Security)

Do NOT repeat basic Java explanations like "this is a class with no fields"
Do NOT describe annotations or methods separately if not relevant
Tag this block with a unique ID like _(AD_<ClassName>) for traceability

Respond in Markdown format.
"""
    return call_gpt(prompt)


# -----------------------------
def generate_docs():
    summaries = load_summary()
    if not summaries:
        return

    md = ["# 📘 AutoDoc Report\n"]

    # 1. Project-level introduction
    print("🧠 Generating project overview...")
    intro = generate_project_intro(summaries)
    md.append("## 🧠 Overview\n")
    md.append(intro)
    md.append("\n---\n")

    # 2. Architecture diagram
    print("📐 Generating architecture diagram...")
    diagram = generate_architecture_diagram(summaries)
    if diagram:
        md.append("## 🧩 Architecture Diagram\n")
        md.append("```plantuml\n" + diagram.replace("```plantuml", "").replace("```", "").strip() + "\n```\n")
        # Save raw .puml file
        plantuml_code = diagram.replace("```plantuml", "").replace("```", "").strip()
        plantuml_file.write_text(plantuml_code)

    # 3. Class-by-class explanation
    for cls in summaries:
        class_name = cls.get("className")
        if class_name.endswith("Application"):
            continue  # Skip Spring Boot main class
        print(f"🔍 Explaining class: {class_name}")
        explanation = generate_class_explanation(cls, summaries, diagram)
        md.append(f"## {class_name}\n{explanation}\n\n---\n")

    # Write final docs
    markdown_file.write_text("\n".join(md))
    print(f"\n✅ Documentation generated: {markdown_file}")
    print(f"🖼️ PlantUML saved: {plantuml_file}")


# -----------------------------
if __name__ == "__main__":
    generate_docs()

# v2
# import json
# from pathlib import Path
# from openai import OpenAI
#
# # Initialize OpenAI client
# client = OpenAI()
#
# # Input and output files
# SUMMARY_FILE = Path("./target/generated-docs/classes-summary.json")
# markdown_file = Path("./target/generated-docs.md")
# plantuml_file = Path("./target/architecture-diagram.puml")
#
# def call_gpt(prompt, model="gpt-4", temperature=0.7):
#     response = client.chat.completions.create(
#         model=model,
#         messages=[{"role": "user", "content": prompt}],
#         temperature=temperature,
#     )
#     return response.choices[0].message.content.strip()
#
# def load_summary():
#     if not SUMMARY_FILE.exists():
#         print("❌ Input summary not found.")
#         return []
#     with open(SUMMARY_FILE, "r") as f:
#         return json.load(f)
#
# def generate_class_description(cls):
#     prompt = f"""
# Analyze the following Java class and explain its purpose, annotations, and methods in simple terms:
#
# {json.dumps(cls, indent=2)}
#
# Format your output in Markdown.
#     """
#     return call_gpt(prompt)
#
# def generate_architecture_diagram(class_summaries):
#     prompt = f"""
# You are a software architect. Based on the following list of Java classes, their annotations, method names, and fields, generate a clean, layered, and high-level architecture diagram using PlantUML code.
#
# **Objective:**
# Produce PlantUML code that clearly represents the application's architecture and responsibilities. Group the classes logically into layers such as:
# - Controllers (e.g., annotated with @RestController)
# - Services (e.g., annotated with @Service)
# - Repositories (e.g., annotated with @Repository)
# - Configuration/Security
# - Domain/Entities (e.g., annotated with @Entity)
# - Filters or Components (e.g., @Component)
# - Main Application class (e.g., @SpringBootApplication)
#
# **Guidelines for the PlantUML diagram:**
# - Clearly separate these groups using `package` blocks.
# - Use only key method signatures or class roles — do not list all methods unless relevant.
# - Minimize "mesh" style arrows. Prefer unidirectional dependencies (top-down: Controller → Service → Repository).
# - Use appropriate stereotypes or colors to indicate class roles (e.g., @Service, @Entity, etc.).
# - Include dependencies (arrows) only where there are real interactions (e.g., UserService → UserRepository).
# - Name relationships meaningfully when needed.
# - Align the layout for readability (top to bottom or left to right flow).
# - Annotate or comment classes as needed for clarity.
#
# Classes:
# {json.dumps(class_summaries, indent=2)}
#     """
#     try:
#         return call_gpt(prompt)
#     except Exception as e:
#         print(f"❌ Failed to generate architecture diagram: {e}")
#         return ""
#
# def generate_docs():
#     summaries = load_summary()
#     if not summaries:
#         return
#
#     md = ["# 📘 AutoDoc Report\n"]
#
#     for cls in summaries:
#         print(f"🔄 Processing class: {cls.get('className')}")
#         description = generate_class_description(cls)
#         md.append(f"## {cls.get('className')}\n{description}\n\n---\n")
#
#     # Add architecture diagram
#     print("📐 Generating architecture diagram...")
#     diagram = generate_architecture_diagram(summaries)
#     if diagram:
#         md.append("## 🧩 Architecture Diagram\n")
#         md.append(diagram)
#         # Save raw .puml file
#         plantuml_code = diagram.replace("```plantuml", "").replace("```", "").strip()
#         plantuml_file.write_text(plantuml_code)
#
#     # Write final markdown file
#     markdown_file.write_text("\n".join(md))
#     print(f"\n✅ Documentation generated: {markdown_file}")
#     print(f"🖼️ PlantUML saved: {plantuml_file}")
#
# if __name__ == "__main__":
#     generate_docs()


#v1
# def generate_docs():
#     if not SUMMARY_FILE.exists():
#         print("❌ Input summary not found.")
#         return

#     summaries = json.loads(SUMMARY_FILE.read_text())
#     md = []

#     for summary in summaries:
#         class_name = summary["className"]
#         print(f"\n🔄 Processing class: {class_name}")
        
#         prompt = f"""
# You are a senior software architect. Given the following Java class summary, generate a detailed explanation of its responsibilities, any design pattern it might follow, and how it fits in a microservices architecture. Write in Markdown format.

# Class Name: {summary['className']}
# Annotations: {', '.join(summary['annotations'])}
# Methods:
# {chr(10).join(summary['methods'])}
#         """
#         try:
#             result = call_gpt(prompt)
#             md.append(f"## {class_name}\n{result}\n\n---\n")
#         except Exception as e:
#             print(f"❌ Failed for {class_name}: {e}")

#     OUTPUT_FILE.write_text("\n".join(md))
#     print(f"\n✅ Documentation written to: {OUTPUT_FILE.resolve()}")

# if __name__ == "__main__":
#     generate_docs()
