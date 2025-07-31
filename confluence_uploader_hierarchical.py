import os
import sys
import json
import requests
from datetime import datetime
from pathlib import Path

# Configuration
CONFLUENCE_URL = os.getenv("CONFLUENCE_URL", "https://sharan99r.atlassian.net")
CONFLUENCE_USER = os.getenv("CONFLUENCE_USER", "sharan99r@gmail.com")
CONFLUENCE_API_TOKEN = os.getenv("CONFLUENCE_API_TOKEN")
SPACE_KEY = os.getenv("SPACE_KEY", "~712020a1106f7965b7429fa169a05d4788f4d5")

# Microservices to scan for documentation
MICROSERVICES = [
    "identityprovider",
    "enrollment", 
    "usermanagement",
    "vehiclemanagement"
]

class ConfluenceUploader:
    def __init__(self):
        self.base_url = f"{CONFLUENCE_URL}/wiki/rest/api"
        self.auth = (CONFLUENCE_USER, CONFLUENCE_API_TOKEN)
        self.headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}

    def _request(self, method, url, **kwargs):
        try:
            response = requests.request(method, url, auth=self.auth, headers=self.headers, **kwargs)
            response.raise_for_status()
            return response
        except requests.RequestException as e:
            print(f"Request failed: {e}")
            return None

    def test_connection(self):
        print("Testing Confluence API connection...")
        print(f"URL: {self.base_url}")
        print(f"Space Key: {SPACE_KEY}")
        print(f"User: {CONFLUENCE_USER}")
        print(f"API Token: {CONFLUENCE_API_TOKEN[:10]}..." if CONFLUENCE_API_TOKEN else "❌ Not set")

        if not CONFLUENCE_API_TOKEN:
            print("❌ CONFLUENCE_API_TOKEN is not set!")
            print("Please run: export CONFLUENCE_API_TOKEN='your-token-here'")
            return None

        # First try to get user info to test basic auth
        user_url = f"{self.base_url}/user/current"
        print(f"Testing user authentication: {user_url}")
        user_response = self._request("GET", user_url)
        if not user_response:
            print("❌ Authentication failed - check your API token")
            print("Generate a new token at: https://id.atlassian.com/manage-profile/security/api-tokens")
            return None

        user_info = user_response.json()
        print(f"✅ Authenticated as: {user_info.get('displayName')} ({user_info.get('email')})")

        # Now test space access
        url = f"{self.base_url}/space/{SPACE_KEY}"
        print(f"Testing space access: {url}")
        response = self._request("GET", url)
        if response:
            space_info = response.json()
            print(f"✅ Connected to space: {space_info.get('name')} ({space_info.get('key')})")
            return space_info
        else:
            # If space access fails, try to list all accessible spaces
            print("❌ Space access failed. Checking available spaces...")
            spaces_url = f"{self.base_url}/space"
            spaces_response = self._request("GET", spaces_url)
            if spaces_response:
                spaces = spaces_response.json().get('results', [])
                available_keys = [s.get('key') for s in spaces]
                print(f"Available spaces: {available_keys}")
                if 'AUTOD' not in available_keys:
                    print(f"❌ AUTOD space not found. Try one of: {available_keys}")
            return None

    def find_existing_page(self, title):
        url = f"{self.base_url}/content"
        params = {'title': title, 'spaceKey': SPACE_KEY, 'expand': 'version'}
        response = self._request("GET", url, params=params)
        if response:
            results = response.json().get('results', [])
            return results[0] if results else None
        return None

    def update_page(self, page_id, title, content, version, parent_id=None):
        data = {
            "version": {"number": version + 1},
            "title": title,
            "type": "page",
            "body": {"storage": {"value": content, "representation": "storage"}}
        }
        if parent_id:
            data["ancestors"] = [{"id": parent_id}]

        url = f"{self.base_url}/content/{page_id}"
        response = self._request("PUT", url, data=json.dumps(data))
        return bool(response)

    def create_page(self, title, content, parent_id=None):
        data = {
            "type": "page",
            "title": title,
            "space": {"key": SPACE_KEY},
            "body": {"storage": {"value": content, "representation": "storage"}}
        }
        if parent_id:
            data["ancestors"] = [{"id": parent_id}]

        url = f"{self.base_url}/content"
        response = self._request("POST", url, data=json.dumps(data))
        return response.json().get('id') if response else None

    def convert_adoc_to_html(self, content):
        html = []
        in_code = False
        for line in content.splitlines():
            if line.strip().startswith('----'):
                html.append('</code></pre>' if in_code else '<pre><code>')
                in_code = not in_code
            elif in_code:
                html.append(line)
            elif line.startswith('= '): html.append(f"<h1>{line[2:].strip()}</h1>")
            elif line.startswith('== '): html.append(f"<h2>{line[3:].strip()}</h2>")
            elif line.startswith('=== '): html.append(f"<h3>{line[4:].strip()}</h3>")
            elif line.startswith('==== '): html.append(f"<h4>{line[5:].strip()}</h4>")
            elif line.strip().startswith(('* ', '- ')):
                html.append(f"<li>{line.strip()[2:]}</li>")
            elif '*' in line:
                html.append(f"<p>{line.replace('*', '<strong>', 1).replace('*', '</strong>', 1)}</p>")
            elif line.strip():
                html.append(f"<p>{line}</p>")
            else:
                html.append('<br/>')
        if in_code:
            html.append('</code></pre>')
        return '\n'.join(html)

    def convert_to_html(self, content, ext):
        if ext == '.adoc':
            return self.convert_adoc_to_html(content)
        elif ext == '.md':
            return f"<pre><code>{content}</code></pre>"
        else:
            return f"<pre><code>{content}</code></pre>"

    def read_file(self, path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            print(f"Could not read file {path}: {e}")
            return None

    def find_docs(self):
        print("Scanning for documentation files...")
        all_docs = {}
        for svc in MICROSERVICES:
            folder = Path(svc, 'documentation')
            print(f"Checking {svc}: {folder}")
            if not folder.exists():
                print(f"  Folder doesn't exist: {folder}")
                continue
            doc_files = [str(p) for p in folder.rglob('*') if p.suffix in ['.md', '.adoc']]
            print(f"  Found {len(doc_files)} files: {doc_files}")
            all_docs[svc] = doc_files
        print(f"Total services with docs: {len(all_docs)}")
        return all_docs

    def upload(self):
        print("Starting upload process...")
        space = self.test_connection()
        if not space:
            print("Failed to connect to Confluence")
            return False

        docs = self.find_docs()
        if not docs:
            print("No documentation found.")
            return False

        print(f"Processing {len(docs)} services...")
        parent_title = "Microservices Documentation"
        parent_page = self.find_existing_page(parent_title)
        parent_content = f"<h1>{parent_title}</h1><p>Updated: {datetime.now()}</p>"

        if parent_page:
            print(f"Updating existing parent page: {parent_title}")
            self.update_page(parent_page['id'], parent_title, parent_content, parent_page['version']['number'])
            parent_id = parent_page['id']
        else:
            print(f"Creating new parent page: {parent_title}")
            parent_id = self.create_page(parent_title, parent_content)

        print(f"Parent page ID: {parent_id}")

        for svc, files in docs.items():
            print(f"\n--- Processing service: {svc} ({len(files)} files) ---")
            svc_title = f"{svc.title()} Documentation"
            svc_page = self.find_existing_page(svc_title)
            svc_content = f"<h2>{svc_title}</h2><p>Updated: {datetime.now()}</p>"
            if svc_page:
                print(f"Updating service page: {svc_title}")
                self.update_page(svc_page['id'], svc_title, svc_content, svc_page['version']['number'], parent_id)
                svc_id = svc_page['id']
            else:
                print(f"Creating service page: {svc_title}")
                svc_id = self.create_page(svc_title, svc_content, parent_id)

            print(f"Service page ID: {svc_id}")

            for f in files:
                fname = os.path.basename(f)
                title = os.path.splitext(fname)[0].replace('_', ' ').title() + f" - {svc.title()}"
                print(f"  Processing file: {fname} -> {title}")
                content = self.read_file(f)
                if not content:
                    print(f"  Could not read file: {f}")
                    continue
                html = self.convert_to_html(content, Path(f).suffix)
                page = self.find_existing_page(title)
                page_content = f"<h3>{title}</h3><p>File: {fname}</p><hr/>{html}"
                if page:
                    print(f"  Updating existing page: {title}")
                    result = self.update_page(page['id'], title, page_content, page['version']['number'], svc_id)
                    print(f"  Update result: {result}")
                else:
                    print(f"  Creating new page: {title}")
                    result = self.create_page(title, page_content, svc_id)
                    print(f"  Create result: {result}")

        print("Upload complete.")
        return True

def main():
    print("Starting upload...")
    if not CONFLUENCE_API_TOKEN:
        print("Missing API token.")
        sys.exit(1)
    uploader = ConfluenceUploader()
    success = uploader.upload()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()