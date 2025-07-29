
#!/usr/bin/env python3
"""
Confluence Documentation Uploader - Hierarchical Structure
This script uploads documentation files from identityprovider/documentation folder to Confluence
as a parent page with child pages for each document.
"""

import os
import sys
import json
import requests
import subprocess
from datetime import datetime
from pathlib import Path

# Configuration - Use environment variables when available
CONFLUENCE_URL = os.getenv("CONFLUENCE_URL", "https://sharan99r.atlassian.net")
CONFLUENCE_USER = os.getenv("CONFLUENCE_USER", "sharan99r@gmail.com")
CONFLUENCE_API_TOKEN = os.getenv("CONFLUENCE_API_TOKEN", "ATATT3xFfGF0YEQDKHLV0oermB28ByBuIADqdGqjym2PvYoOQc3Xg_z0fwGiucI2El0RaQGFSFFxEpXgH1SqtyWyvOc7sqoOuPVxCe033l-1-c6_glF5CWf1M7qe5o7nFAbwK4Abwa-at7XCewkcAJbfn7jCu53CnQYbPNfzFPlrAK-LzqdJCt8=E58519F7")
SPACE_KEY = os.getenv("SPACE_KEY", "~712020a1106f7965b7429fa169a05d4788f4d5")
DOCS_FOLDER = os.getenv("DOCS_FOLDER", "./identityprovider/documentation")

class ConfluenceUploader:
    def __init__(self):
        self.base_url = f"{CONFLUENCE_URL}/wiki/rest/api"
        self.auth = (CONFLUENCE_USER, CONFLUENCE_API_TOKEN)
        self.headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }

    def test_connection(self):
        """Test connection to Confluence API"""
        print("Testing Confluence API connection...")
        try:
            response = requests.get(
                f"{self.base_url}/space/{SPACE_KEY}",
                auth=self.auth,
                headers=self.headers
            )

            if response.status_code == 200:
                space_info = response.json()
                print("Successfully connected to Confluence!")
                print(f"Space Name: {space_info.get('name', 'Unknown')}")
                print(f"Space Key: {space_info.get('key', 'Unknown')}")
                return space_info
            else:
                print(f"Failed to connect: HTTP {response.status_code}")
                print(f"Response: {response.text}")
                return None

        except Exception as e:
            print(f"Connection error: {str(e)}")
            return None

    def find_existing_page_by_title(self, title):
        """Find an existing page by title in the space"""
        try:
            search_url = f"{self.base_url}/content"
            params = {
                'title': title,
                'spaceKey': SPACE_KEY,
                'expand': 'version'
            }

            response = requests.get(search_url, auth=self.auth, params=params)

            if response.status_code == 200:
                results = response.json().get('results', [])
                if results:
                    page = results[0]
                    print(f"Found existing page: '{title}' (ID: {page['id']})")
                    return page

            return None

        except Exception as e:
            print(f"Error searching for page '{title}': {str(e)}")
            return None

    def find_parent_page(self):
        """Find the main parent documentation page"""
        try:
            search_url = f"{self.base_url}/content"
            params = {
                'title': 'Identity Provider Documentation',
                'spaceKey': SPACE_KEY,
                'expand': 'version'
            }

            response = requests.get(search_url, auth=self.auth, params=params)

            if response.status_code == 200:
                results = response.json().get('results', [])
                if results:
                    for page in results:
                        title = page['title']
                        if title == 'Identity Provider Documentation':
                            print(f"Found existing parent page: '{title}' (ID: {page['id']})")
                            return page

            print("No existing parent page found")
            return None

        except Exception as e:
            print(f"Error searching for parent page: {str(e)}")
            return None

    def find_child_pages(self, parent_id):
        """Find existing child pages under the parent"""
        try:
            search_url = f"{self.base_url}/content/{parent_id}/child/page"
            params = {
                'expand': 'version',
                'limit': 50
            }

            response = requests.get(search_url, auth=self.auth, params=params)

            if response.status_code == 200:
                results = response.json().get('results', [])
                child_pages = {}
                for page in results:
                    title = page['title']
                    if title == 'Architecture Design' or 'Architecture Design' in title:
                        child_pages['architecturedesign.adoc'] = page
                    elif title == 'Detailed Design' or 'Detailed Design' in title:
                        child_pages['detaileddesign.adoc'] = page
                    elif title == 'OpenAPI Specification' or 'OpenAPI Specification' in title:
                        child_pages['openApiSpecification.adoc'] = page

                if child_pages:
                    print(f"Found {len(child_pages)} existing child pages:")
                    for filename, page in child_pages.items():
                        print(f"   - {page['title']} (ID: {page['id']})")

                return child_pages
            else:
                print(f"Could not fetch child pages: HTTP {response.status_code}")
                return {}

        except Exception as e:
            print(f"Error finding child pages: {str(e)}")
            return {}

    def update_page_content(self, page_id, title, content, current_version):
        """Update an existing page with new content"""
        try:
            update_data = {
                "version": {
                    "number": current_version + 1
                },
                "title": title,
                "type": "page",
                "body": {
                    "storage": {
                        "value": content,
                        "representation": "storage"
                    }
                }
            }

            response = requests.put(
                f"{self.base_url}/content/{page_id}",
                auth=self.auth,
                headers=self.headers,
                data=json.dumps(update_data)
            )

            if response.status_code == 200:
                print("  Page updated successfully")
                return True
            else:
                print(f"  Failed to update page: HTTP {response.status_code}")
                print(f"  Response: {response.text}")
                return False

        except Exception as e:
            print(f"  Error updating page: {str(e)}")
            return False

    def find_documentation_files(self):
        """Find all documentation files in the specified folder"""
        print(f"Scanning for documentation files in: {DOCS_FOLDER}")

        if not os.path.exists(DOCS_FOLDER):
            print(f"Documentation folder not found: {DOCS_FOLDER}")
            return [], []

        doc_files = []
        diagram_files = []
        supported_extensions = ['.md', '.adoc', '.txt', '.rst']
        diagram_extensions = ['.png', '.jpg', '.jpeg', '.gif', '.puml', '.plantuml']

        for file_path in Path(DOCS_FOLDER).rglob('*'):
            if file_path.is_file():
                if file_path.suffix.lower() in supported_extensions:
                    doc_files.append(str(file_path))
                elif file_path.suffix.lower() in diagram_extensions:
                    diagram_files.append(str(file_path))

        print(f"Found {len(doc_files)} documentation files:")
        for file in doc_files:
            print(f"   - {os.path.basename(file)}")

        if diagram_files:
            print(f"Found {len(diagram_files)} diagram files:")
            for file in diagram_files:
                print(f"   - {os.path.basename(file)}")

        return doc_files, diagram_files

    def read_file_content(self, file_path):
        """Read and return file content"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            print(f"Error reading {file_path}: {str(e)}")
            return None
            return None

    def convert_adoc_to_html(self, content):
        """Convert AsciiDoc content to HTML for Confluence"""
        lines = content.split('\n')
        html_lines = []
        in_code_block = False

        for line in lines:
            if line.strip().startswith('----'):
                if in_code_block:
                    html_lines.append('</code></pre>')
                    in_code_block = False
                else:
                    html_lines.append('<pre><code>')
                    in_code_block = True
                continue

            if in_code_block:
                html_lines.append(line)
                continue

            # Handle headers
            if line.startswith('= '):
                html_lines.append(f'<h1>{line[2:].strip()}</h1>')
            elif line.startswith('== '):
                html_lines.append(f'<h2>{line[3:].strip()}</h2>')
            elif line.startswith('=== '):
                html_lines.append(f'<h3>{line[4:].strip()}</h3>')
            elif line.startswith('==== '):
                html_lines.append(f'<h4>{line[5:].strip()}</h4>')

            # Handle lists
            elif line.strip().startswith('* '):
                html_lines.append(f'<li>{line.strip()[2:]}</li>')
            elif line.strip().startswith('- '):
                html_lines.append(f'<li>{line.strip()[2:]}</li>')

            # Handle bold text
            elif '*' in line:
                line = line.replace('*', '<strong>', 1).replace('*', '</strong>', 1)
                html_lines.append(f'<p>{line}</p>')

            # Handle regular paragraphs
            elif line.strip():
                html_lines.append(f'<p>{line}</p>')

            # Handle empty lines
            else:
                html_lines.append('<br/>')

        if in_code_block:
            html_lines.append('</code></pre>')

        return '\n'.join(html_lines)

    def convert_to_html(self, content, file_extension):
        """Convert file content to HTML for Confluence"""
        if file_extension.lower() == '.md':
            content = content.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            content = content.replace('\n# ', '\n<h1>').replace('\n## ', '\n<h2>').replace('\n### ', '\n<h3>')
            content = content.replace('**', '<strong>').replace('**', '</strong>')
            content = content.replace('\n\n', '</p><p>')
            content = f"<p>{content}</p>"
        elif file_extension.lower() == '.adoc':
            content = self.convert_adoc_to_html(content)
        else:
            content = content.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            content = f"<pre><code>{content}</code></pre>"

        return content

    def create_parent_page(self, space_info, doc_files):
        """Create or update the parent page for the documentation"""
        print("Checking for existing parent documentation page...")

        existing_parent = self.find_parent_page()

        current_time = datetime.now().strftime("%B %d, %Y at %H:%M:%S")
        parent_content = f"""
        <h1>Identity Provider Documentation</h1>
        <p><strong>Last Updated:</strong> {current_time}</p>
        <p><strong>Source:</strong> identityprovider/documentation</p>
        <p><strong>Files processed:</strong> {len(doc_files)}</p>
        <hr/>
        <h2>Documentation Structure</h2>
        <p>This documentation is organized into the following sections:</p>
        <ul>
            <li><strong>Architecture Design</strong> - Overall system architecture and design patterns</li>
            <li><strong>Detailed Design</strong> - Detailed implementation specifications</li>
            <li><strong>OpenAPI Specification</strong> - API documentation and endpoints</li>
        </ul>
        <p>Each section is available as a child page below.</p>
        """

        parent_title = "Identity Provider Documentation"

        if existing_parent:
            print("Updating existing parent page...")
            page_id = existing_parent['id']
            title = existing_parent['title']
            current_version = existing_parent['version']['number']

            if self.update_page_content(page_id, title, parent_content, current_version):
                print("Parent page updated successfully!")
                print(f"Page Title: {title}")
                print(f"Page ID: {page_id}")
                return page_id, title, "UPDATE"
            else:
                print("Failed to update parent page, will try to create new one...")

        print("Creating new parent documentation page...")

        try:
            create_data = {
                "type": "page",
                "title": parent_title,
                "space": {
                    "key": SPACE_KEY
                },
                "body": {
                    "storage": {
                        "value": parent_content,
                        "representation": "storage"
                    }
                }
            }

            response = requests.post(
                f"{self.base_url}/content",
                auth=self.auth,
                headers=self.headers,
                data=json.dumps(create_data)
            )

            if response.status_code == 200:
                page_info = response.json()
                page_id = page_info.get('id')
                print("Parent page created successfully!")
                print(f"Page Title: {parent_title}")
                print(f"Page ID: {page_id}")
                return page_id, parent_title, "CREATE"
            else:
                print(f"Failed to create parent page: HTTP {response.status_code}")
                print(f"Response: {response.text}")

                if response.status_code == 400 and "already exists" in response.text.lower():
                    print("Page already exists, trying to find and update it...")
                    existing_page_by_title = self.find_existing_page_by_title(parent_title)
                    if existing_page_by_title:
                        page_id = existing_page_by_title['id']
                        current_version = existing_page_by_title['version']['number']
                        if self.update_page_content(page_id, parent_title, parent_content, current_version):
                            print("Found and updated existing parent page!")
                            return page_id, parent_title, "UPDATE"

                return None, None, None

        except Exception as e:
            print(f"Error creating parent page: {str(e)}")
            return None, None, None

    def create_child_page(self, parent_id, file_path, file_content, existing_child_pages=None):
        """Create or update a child page for a specific documentation file"""
        file_name = os.path.basename(file_path)
        file_extension = os.path.splitext(file_path)[1]

        title_mapping = {
            'architecturedesign.adoc': 'Architecture Design',
            'detaileddesign.adoc': 'Detailed Design',
            'openApiSpecification.adoc': 'OpenAPI Specification'
        }

        base_title = title_mapping.get(file_name, file_name.replace('.adoc', '').replace('_', ' ').title())
        existing_page = existing_child_pages.get(file_name) if existing_child_pages else None

        try:
            html_content = self.convert_to_html(file_content, file_extension)
            current_time = datetime.now().strftime("%B %d, %Y at %H:%M:%S")

            full_content = f"""
            <h1>{base_title}</h1>
            <p><strong>Source File:</strong> {file_name}</p>
            <p><strong>Last Updated:</strong> {current_time}</p>
            <hr/>
            {html_content}
            """

            if existing_page:
                print(f"Updating existing child page: {existing_page['title']}")
                page_id = existing_page['id']
                page_title = existing_page['title']
                current_version = existing_page['version']['number']

                if self.update_page_content(page_id, page_title, full_content, current_version):
                    print(f"  Child page '{page_title}' updated successfully")
                    return True
                else:
                    print("  Failed to update page, will try to create new one...")

            print(f"Creating new child page: {base_title}")

            create_data = {
                "type": "page",
                "title": base_title,
                "space": {
                    "key": SPACE_KEY
                },
                "ancestors": [
                    {
                        "id": parent_id
                    }
                ],
                "body": {
                    "storage": {
                        "value": full_content,
                        "representation": "storage"
                    }
                }
            }

            response = requests.post(
                f"{self.base_url}/content",
                auth=self.auth,
                headers=self.headers,
                data=json.dumps(create_data)
            )

            if response.status_code == 200:
                page_info = response.json()
                child_page_id = page_info.get('id')
                print(f"  Child page '{base_title}' created (ID: {child_page_id})")
                return True
            else:
                print(f"  Failed to create child page '{base_title}': HTTP {response.status_code}")

                if response.status_code == 400 and "already exists" in response.text.lower():
                    print("  Page already exists, trying to find and update it...")
                    existing_page_by_title = self.find_existing_page_by_title(base_title)
                    if existing_page_by_title:
                        page_id = existing_page_by_title['id']
                        current_version = existing_page_by_title['version']['number']
                        if self.update_page_content(page_id, base_title, full_content, current_version):
                            print(f"  Found and updated existing page '{base_title}'")
                            return True

                return False

        except Exception as e:
            print(f"  Error processing child page '{base_title}': {str(e)}")
            return False

    def upload_documentation(self):
        """Main method to upload all documentation"""
        print("Starting Confluence Documentation Upload")
        print("=" * 50)

        space_info = self.test_connection()
        if not space_info:
            return False

        doc_files, diagram_files = self.find_documentation_files()
        if not doc_files:
            print("No documentation files found to upload.")
            print(f"Searched in folder: {DOCS_FOLDER}")
            if os.path.exists(DOCS_FOLDER):
                print("Folder exists but contains no supported files (.md, .adoc, .txt, .rst)")
                try:
                    files_in_folder = os.listdir(DOCS_FOLDER)
                    print(f"Files in folder: {files_in_folder}")
                except Exception as e:
                    print(f"Could not list folder contents: {e}")
            else:
                print("Documentation folder does not exist")
            return False

        print(f"\nReady to process {len(doc_files)} documentation files.")
        print("This will:")
        print("  Create/Update parent page: Identity Provider Documentation")
        for file_path in doc_files:
            file_name = os.path.basename(file_path)
            title_mapping = {
                'architecturedesign.adoc': 'Architecture Design',
                'detaileddesign.adoc': 'Detailed Design',
                'openApiSpecification.adoc': 'OpenAPI Specification'
            }
            page_title = title_mapping.get(file_name, file_name.replace('.adoc', '').replace('_', ' ').title())
            print(f"  Create/Update child page: {page_title}")

        print("\nProceeding with upload/update...")

        parent_id, parent_title, operation = self.create_parent_page(space_info, doc_files)
        if not parent_id:
            print("Failed to create/update parent page. Aborting.")
            return False

        existing_child_pages = self.find_child_pages(parent_id)

        action_word = "Updating" if existing_child_pages else "Creating"
        print(f"\n{action_word} {len(doc_files)} child pages...")
        success_count = 0
        failed_files = []

        for i, file_path in enumerate(doc_files, 1):
            file_name = os.path.basename(file_path)
            print(f"\n[{i}/{len(doc_files)}] Processing: {file_name}")

            file_content = self.read_file_content(file_path)
            if file_content:
                if self.create_child_page(parent_id, file_path, file_content, existing_child_pages):
                    success_count += 1
                    action = "updated" if file_name in existing_child_pages else "created"
                    print(f"  Successfully {action} child page for {file_name}")
                else:
                    failed_files.append(file_name)
                    print(f"  Failed to process child page for {file_name}")
            else:
                failed_files.append(file_name)
                print(f"  Could not read content from {file_name}")

        print(f"\n{'='*50}")
        print("Documentation upload completed!")
        print(f"Parent page {operation.lower()}d: {parent_title}")
        print(f"{success_count}/{len(doc_files)} child pages processed successfully")
        if failed_files:
            print(f"Failed files: {', '.join(failed_files)}")
        print(f"View at: {CONFLUENCE_URL}/wiki/spaces/{SPACE_KEY}/pages/{parent_id}")

        return success_count == len(doc_files)

def main():
    """Main entry point"""
    print("Starting Confluence Documentation Uploader")
    print(f"Current working directory: {os.getcwd()}")
    print(f"Documentation folder: {DOCS_FOLDER}")
    print(f"Confluence URL: {CONFLUENCE_URL}")
    print(f"Space Key: {SPACE_KEY}")
    print("-" * 50)

    # Check if documentation folder exists
    if not os.path.exists(DOCS_FOLDER):
        print(f"ERROR: Documentation folder does not exist: {DOCS_FOLDER}")
        print("Available files in current directory:")
        try:
            for item in os.listdir("."):
                print(f"  - {item}")
        except Exception as e:
            print(f"  Could not list directory: {e}")
        sys.exit(1)

    try:
        uploader = ConfluenceUploader()
        success = uploader.upload_documentation()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"ERROR: Script failed with exception: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
