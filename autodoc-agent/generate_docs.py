import json
from pathlib import Path
from openai import OpenAI

# Initialize OpenAI client
client = OpenAI()

# Input and output files
SUMMARY_FILE = Path("./target/generated-docs/classes-summary.json")
OUTPUT_FILE = Path("./target/generated-docs.md")

def call_gpt(prompt, model="gpt-4", temperature=0.7):
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,
    )
    return response.choices[0].message.content.strip()

def generate_docs():
    if not SUMMARY_FILE.exists():
        print("❌ Input summary not found.")
        return

    summaries = json.loads(SUMMARY_FILE.read_text())
    md = []

    for summary in summaries:
        class_name = summary["className"]
        print(f"\n🔄 Processing class: {class_name}")
        
        prompt = f"""
You are a senior software architect. Given the following Java class summary, generate a detailed explanation of its responsibilities, any design pattern it might follow, and how it fits in a microservices architecture. Write in Markdown format.

Class Name: {summary['className']}
Annotations: {', '.join(summary['annotations'])}
Methods:
{chr(10).join(summary['methods'])}
        """
        try:
            result = call_gpt(prompt)
            md.append(f"## {class_name}\n{result}\n\n---\n")
        except Exception as e:
            print(f"❌ Failed for {class_name}: {e}")

    OUTPUT_FILE.write_text("\n".join(md))
    print(f"\n✅ Documentation written to: {OUTPUT_FILE.resolve()}")

if __name__ == "__main__":
    generate_docs()
