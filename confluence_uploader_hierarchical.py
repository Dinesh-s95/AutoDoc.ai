import os
import sys
import json
import requests
import re
import subprocess
import base64
import zlib
from datetime import datetime
from pathlib import Path
 
# Configuration
CONFLUENCE_URL = os.getenv("CONFLUENCE_URL", "https://sharan99r.atlassian.net")
CONFLUENCE_USER = os.getenv("CONFLUENCE_USER", "sharan99r@gmail.com")
CONFLUENCE_API_TOKEN = os.getenv("CONFLUENCE_API_TOKEN","ATATT3xFfGF0aOGqDQfxsCI9Zl2RHA_jBzhr5GLhZlw2eQIryWgfuXh-ovJ0vaOLkUdojxW2YCrVeHNRnaAlj4N23E-f10W1ppXRxDqfhD3qU1Xk2-DrJ-CCfQwf8X8zMw021Ea5jYyCaOl0ZriLHspcSMBfiLpUSD7c8ZTBX7If3jbaP22kz0s=828D2C0B")
SPACE_KEY = os.getenv("SPACE_KEY", "~712020a1106f7965b7429fa169a05d4788f4d5")
 
# Microservices to scan for documentation
MICROSERVICES = [
    "identityprovider",
    "enrollment",
    "usermanagement",
    "vehiclemanagement"
]
 
def plantuml_encode(text):
    """Encodes PlantUML text for server URL."""
    def encode6bit(b):
        if b < 10:
            return chr(48 + b)
        b -= 10
        if b < 26:
            return chr(65 + b)
        b -= 26
        if b < 26:
            return chr(97 + b)
        b -= 26
        if b == 0:
            return '-'
        if b == 1:
            return '_'
        return '?'
    data = zlib.compress(text.encode('utf-8'))
    data = data[2:-4]
    res = ''
    i = 0
    while i < len(data):
        if i+2 < len(data):
            b1 = data[i]
            b2 = data[i+1]
            b3 = data[i+2]
            res += encode6bit((b1 >> 2) & 0x3F)
            res += encode6bit(((b1 << 4) | (b2 >> 4)) & 0x3F)
            res += encode6bit(((b2 << 2) | (b3 >> 6)) & 0x3F)
            res += encode6bit(b3 & 0x3F)
            i += 3
        elif i+1 < len(data):
            b1 = data[i]
            b2 = data[i+1]
            res += encode6bit((b1 >> 2) & 0x3F)
            res += encode6bit(((b1 << 4) | (b2 >> 4)) & 0x3F)
            res += encode6bit((b2 << 2) & 0x3F)
            i += 2
        else:
            b1 = data[i]
            res += encode6bit((b1 >> 2) & 0x3F)
            res += encode6bit((b1 << 4) & 0x3F)
            i += 1
    return res
 
def plantuml_url(uml_code):
    encoded = plantuml_encode(uml_code)
    return f"https://www.plantuml.com/plantuml/png/{encoded}"
 
 
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
                if SPACE_KEY not in available_keys:
                    print(f"❌ {SPACE_KEY} space not found. Try one of: {available_keys}")
            return None

    def format_text(self, text):
        """Format bold, italic, and other text formatting"""
        # Handle bold text **text** or *text*
        text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', text)
        text = re.sub(r'(?<!\*)\*([^*\s].*?[^*\s])\*(?!\*)', r'<strong>\1</strong>', text)
        
        # Handle italic text _text_
        text = re.sub(r'_([^_\s].*?[^_\s])_', r'<em>\1</em>', text)
        
        # Handle inline code `code`
        text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
        
        # Handle links
        text = re.sub(r'link:([^\[]+)\[([^\]]+)\]', r'<a href="\1">\2</a>', text)
        text = re.sub(r'https?://[^\s\]]+', r'<a href="\g<0>">\g<0></a>', text)
        
        return text

    def convert_adoc_to_html(self, content):
        """Improved AsciiDoc to HTML conversion"""
        lines = content.splitlines()
        html = []
        in_code_block = False
        in_list = False
        code_block_content = []
        code_language = 'text'
        
        i = 0
        while i < len(lines):
            line = lines[i].rstrip()
            
            # Handle source blocks with language specification
            if re.match(r'^\[source,(\w+)\]', line):
                if in_list:
                    html.append('</ul>')
                    in_list = False
                # Extract language
                lang_match = re.match(r'^\[source,(\w+)\]', line)
                code_language = lang_match.group(1) if lang_match else 'text'
                i += 1
                continue
            
            # Handle code blocks (various AsciiDoc formats)
            elif line.startswith('----') or line.startswith('```'):
                if in_code_block:
                    # End of code block
                    if code_block_content:
                        content_str = '\n'.join(code_block_content)
                        # Check if it's OpenAPI content
                        if code_language.lower() in ['openapi', 'yaml', 'yml'] and self.is_openapi_content(content_str):
                            html.append('<ac:structured-macro ac:name="open-api">')
                            html.append('<ac:parameter ac:name="src">data:application/yaml;base64,' + base64.b64encode(content_str.encode('utf-8')).decode('utf-8') + '</ac:parameter>')
                            html.append('</ac:structured-macro>')
                        else:
                            html.append('<ac:structured-macro ac:name="code">')
                            html.append(f'<ac:parameter ac:name="language">{code_language}</ac:parameter>')
                            html.append('<ac:plain-text-body><![CDATA[')
                            html.append(content_str)
                            html.append(']]></ac:plain-text-body>')
                            html.append('</ac:structured-macro>')
                    in_code_block = False
                    code_block_content = []
                    code_language = 'text'
                else:
                    # Start of code block
                    if in_list:
                        html.append('</ul>')
                        in_list = False
                    in_code_block = True
                    
            elif in_code_block:
                # Inside code block - collect content
                code_block_content.append(line)
                
            elif line.startswith('= '):
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append(f'<h1>{line[2:].strip()}</h1>')
                
            elif line.startswith('== '):
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append(f'<h2>{line[3:].strip()}</h2>')
                
            elif line.startswith('=== '):
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append(f'<h3>{line[4:].strip()}</h3>')
                
            elif line.startswith('==== '):
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append(f'<h4>{line[5:].strip()}</h4>')
                
            elif line.startswith('===== '):
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append(f'<h5>{line[6:].strip()}</h5>')
                
            elif line.strip().startswith(('* ', '- ')):
                # Handle lists properly
                if not in_list:
                    html.append('<ul>')
                    in_list = True
                list_content = line.strip()[2:].strip()
                list_content = self.format_text(list_content)
                html.append(f'<li>{list_content}</li>')
                
            elif line.strip().startswith('. '):
                # Numbered list
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append('<ol>')
                list_content = line.strip()[2:].strip()
                list_content = self.format_text(list_content)
                html.append(f'<li>{list_content}</li>')
                
                # Look ahead for more numbered items
                j = i + 1
                while j < len(lines) and lines[j].strip().startswith('. '):
                    list_content = lines[j].strip()[2:].strip()
                    list_content = self.format_text(list_content)
                    html.append(f'<li>{list_content}</li>')
                    j += 1
                html.append('</ol>')
                i = j - 1  # Skip the processed lines
                
            elif line.strip() == '':
                # Close list on empty line
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append('<br/>')
                
            elif line.strip():
                # Regular paragraph
                if in_list:
                    html.append('</ul>')
                    in_list = False
                formatted_line = self.format_text(line.strip())
                html.append(f'<p>{formatted_line}</p>')
            
            i += 1
        
        # Close any remaining open tags
        if in_list:
            html.append('</ul>')
        if in_code_block and code_block_content:
            content_str = '\n'.join(code_block_content)
            # Check if it's OpenAPI content
            if code_language.lower() in ['openapi', 'yaml', 'yml'] and self.is_openapi_content(content_str):
                html.append('<ac:structured-macro ac:name="open-api">')
                html.append('<ac:parameter ac:name="src">data:application/yaml;base64,' + base64.b64encode(content_str.encode('utf-8')).decode('utf-8') + '</ac:parameter>')
                html.append('</ac:structured-macro>')
            else:
                html.append('<ac:structured-macro ac:name="code">')
                html.append(f'<ac:parameter ac:name="language">{code_language}</ac:parameter>')
                html.append('<ac:plain-text-body><![CDATA[')
                html.append(content_str)
                html.append(']]></ac:plain-text-body>')
                html.append('</ac:structured-macro>')
        
        return '\n'.join(html)

    def convert_markdown_to_html(self, content):
        """Basic markdown to HTML conversion"""
        lines = content.splitlines()
        html = []
        in_code_block = False
        code_content = []
        code_language = 'text'
        in_list = False
        
        for line in lines:
            if line.startswith('```'):
                if in_code_block:
                    # End code block
                    html.append('<ac:structured-macro ac:name="code">')
                    html.append(f'<ac:parameter ac:name="language">{code_language}</ac:parameter>')
                    html.append('<ac:plain-text-body><![CDATA[')
                    html.append('\n'.join(code_content))
                    html.append(']]></ac:plain-text-body>')
                    html.append('</ac:structured-macro>')
                    code_content = []
                    in_code_block = False
                    code_language = 'text'
                else:
                    # Start code block
                    if in_list:
                        html.append('</ul>')
                        in_list = False
                    in_code_block = True
                    # Extract language if specified
                    lang_match = re.match(r'^```(\w+)', line)
                    code_language = lang_match.group(1) if lang_match else 'text'
                    
            elif in_code_block:
                code_content.append(line)
                
            elif line.startswith('# '):
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append(f'<h1>{line[2:].strip()}</h1>')
                
            elif line.startswith('## '):
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append(f'<h2>{line[3:].strip()}</h2>')
                
            elif line.startswith('### '):
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append(f'<h3>{line[4:].strip()}</h3>')
                
            elif line.strip().startswith(('* ', '- ')):
                if not in_list:
                    html.append('<ul>')
                    in_list = True
                content = line.strip()[2:].strip()
                content = self.format_text(content)
                html.append(f'<li>{content}</li>')
                
            elif line.strip() == '':
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append('<br/>')
                
            elif line.strip():
                if in_list:
                    html.append('</ul>')
                    in_list = False
                formatted = self.format_text(line.strip())
                html.append(f'<p>{formatted}</p>')
        
        # Close any remaining tags
        if in_list:
            html.append('</ul>')
        if in_code_block and code_content:
            content_str = '\n'.join(code_content)
            # Check if it's OpenAPI content
            if code_language.lower() in ['openapi', 'yaml', 'yml'] and self.is_openapi_content(content_str):
                html.append('<ac:structured-macro ac:name="open-api">')
                html.append('<ac:parameter ac:name="src">data:application/yaml;base64,' + base64.b64encode(content_str.encode('utf-8')).decode('utf-8') + '</ac:parameter>')
                html.append('</ac:structured-macro>')
            else:
                html.append('<ac:structured-macro ac:name="code">')
                html.append(f'<ac:parameter ac:name="language">{code_language}</ac:parameter>')
                html.append('<ac:plain-text-body><![CDATA[')
                html.append(content_str)
                html.append(']]></ac:plain-text-body>')
                html.append('</ac:structured-macro>')
        
        return '\n'.join(html)

    def is_openapi_content(self, content):
        """Check if content appears to be OpenAPI specification"""
        content_lower = content.lower().strip()
        # Check for common OpenAPI indicators
        openapi_indicators = [
            'openapi:', 
            'swagger:', 
            'info:', 
            'paths:', 
            'components:',
            '"openapi":', 
            '"swagger":', 
            '"info":', 
            '"paths":', 
            '"components":'
        ]
        return any(indicator in content_lower for indicator in openapi_indicators)

    def render_plantuml_blocks(self, content, doc_dir):
        """Enhanced PlantUML and source block detection with better encoding"""
        def replace_block(match):
            # Get the captured groups
            plantuml_block = match.group(1) if len(match.groups()) > 0 and match.group(1) else None
            markdown_block = match.group(2) if len(match.groups()) > 1 and match.group(2) else None  
            raw_block = match.group(3) if len(match.groups()) > 2 and match.group(3) else None
            
            uml_code = plantuml_block or markdown_block or raw_block
            
            if uml_code:
                uml_code = uml_code.strip()
                if '@startuml' in uml_code and '@enduml' in uml_code:
                    try:
                        # Try to generate PlantUML URL
                        url = plantuml_url(uml_code)
                        # Use Confluence's built-in PlantUML macro instead of external URL
                        return f'''<ac:structured-macro ac:name="plantuml">
<ac:plain-text-body><![CDATA[{uml_code}]]></ac:plain-text-body>
</ac:structured-macro>'''
                    except Exception as e:
                        print(f"Error generating PlantUML: {e}")
                        return f'<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">plantuml</ac:parameter><ac:plain-text-body><![CDATA[{uml_code}]]></ac:plain-text-body></ac:structured-macro>'
            
            return match.group(0)  # Return original if no match

        # Enhanced pattern to catch PlantUML blocks
        pattern = re.compile(
            r'(?:\[plantuml.*?\]\s*[-.]{4,}\s*(@startuml.*?@enduml)\s*[-.]{4,})|' +  # [plantuml] blocks
            r'(?:```plantuml\s*(@startuml.*?@enduml)\s*```)|' +                      # markdown plantuml
            r'(?:^(@startuml.*?@enduml)$)',                                          # raw plantuml
            re.DOTALL | re.IGNORECASE | re.MULTILINE
        )

        return pattern.sub(replace_block, content)
 
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

    def convert_to_html(self, content, ext):
        """Updated conversion method with PlantUML processing"""
        # First process PlantUML blocks
        content = self.render_plantuml_blocks(content, Path('.'))
        
        if ext == '.adoc':
            return self.convert_adoc_to_html(content)
        elif ext == '.md':
            return self.convert_markdown_to_html(content)
        else:
            return f'<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[{content}]]></ac:plain-text-body></ac:structured-macro>'
 
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
                    page_id = self.create_page(title, page_content, svc_id)
                    print(f"  Create result: {page_id}")
 
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