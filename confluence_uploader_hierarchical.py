import os
import sys
import json
import requests
import re
import subprocess
import base64
import zlib
import hashlib
from datetime import datetime
from pathlib import Path
import html

# Configuration
CONFLUENCE_URL = os.getenv("CONFLUENCE_URL", "https://autodoc-ai.atlassian.net")
CONFLUENCE_USER = os.getenv("CONFLUENCE_USER", "sharanr498@gmail.com")
CONFLUENCE_API_TOKEN = os.getenv("CONFLUENCE_API_TOKEN")
SPACE_KEY = os.getenv("SPACE_KEY", "XFLOW")

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

def mermaid_to_confluence_macro(mermaid_code):
    """Converts Mermaid diagram to Confluence macro"""
    escaped_code = html.escape(mermaid_code)
    return f"""<ac:structured-macro ac:name="mermaid" ac:schema-version="1">
    <ac:parameter ac:name="theme">default</ac:parameter>
    <ac:plain-text-body><![CDATA[{escaped_code}]]></ac:plain-text-body>
</ac:structured-macro>"""

def drawio_to_confluence_macro(drawio_code):
    """Converts Draw.io diagram to Confluence macro"""
    encoded = base64.b64encode(drawio_code.encode('utf-8')).decode('utf-8')
    return f"""<ac:structured-macro ac:name="drawio" ac:schema-version="1">
    <ac:parameter ac:name="simple">0</ac:parameter>
    <ac:parameter ac:name="zoom">1</ac:parameter>
    <ac:parameter ac:name="format">png</ac:parameter>
    <ac:plain-text-body><![CDATA[{encoded}]]></ac:plain-text-body>
</ac:structured-macro>"""

class ConfluenceUploader:
    def __init__(self):
        self.base_url = f"{CONFLUENCE_URL}/wiki/rest/api"
        self.auth = (CONFLUENCE_USER, CONFLUENCE_API_TOKEN)
        self.headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
        self.hash_file = 'file_hashes.json'

    def load_hashes(self):
        """Load existing file hashes"""
        if os.path.exists(self.hash_file):
            try:
                with open(self.hash_file, 'r') as f:
                    return json.load(f)
            except:
                return {}
        return {}

    def save_hashes(self, hashes):
        """Save file hashes"""
        with open(self.hash_file, 'w') as f:
            json.dump(hashes, f, indent=2)

    def get_file_hash(self, file_path):
        """Calculate MD5 hash of file content"""
        try:
            with open(file_path, 'rb') as f:
                return hashlib.md5(f.read()).hexdigest()
        except:
            return None

    def has_file_changed(self, file_path, hashes):
        """Check if file has changed since last upload"""
        current_hash = self.get_file_hash(file_path)
        if not current_hash:
            return True
        
        stored_hash = hashes.get(file_path)
        return current_hash != stored_hash

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

    def render_all_diagrams(self, content, doc_dir):
        """
        Enhanced diagram rendering that handles multiple diagram types
        """
        # Handle PlantUML diagrams
        content = self.render_plantuml_blocks(content, doc_dir)
        
        # Handle Mermaid diagrams
        content = self.render_mermaid_blocks(content)
        
        # Handle Draw.io diagrams
        content = self.render_drawio_blocks(content)
        
        return content

    def render_plantuml_blocks(self, content, doc_dir):
        """
        Enhanced PlantUML block detection and replacement
        """
        def replace_block(match):
            uml_code = match.group(1).strip() if match.groups() else match.group(0).strip()
            
            if uml_code:
                # Ensure proper PlantUML format
                if not uml_code.startswith('@startuml'):
                    uml_code = f'@startuml\n{uml_code}\n@enduml'
                
                url = plantuml_url(uml_code)
                # Use a placeholder that won't be affected by inline formatting
                return f'PLANTUML_IMAGE_PLACEHOLDER_{url}_END_PLACEHOLDER'
            return match.group(0)

        # Pattern 1: AsciiDoc plantuml blocks with ---- delimiters
        pattern1 = r'\[plantuml[^\]]*\]\s*\n----\s*\n(@startuml.*?@enduml)\s*\n----'
        content = re.sub(pattern1, replace_block, content, flags=re.DOTALL | re.IGNORECASE)
        
        # Pattern 2: AsciiDoc plantuml blocks with .... delimiters  
        pattern2 = r'\[plantuml[^\]]*\]\s*\n\.\.\.\.\s*\n(@startuml.*?@enduml)\s*\n\.\.\.\.'
        content = re.sub(pattern2, replace_block, content, flags=re.DOTALL | re.IGNORECASE)
        
        # Pattern 3: Raw PlantUML blocks (standalone @startuml...@enduml)
        pattern3 = r'^(@startuml.*?@enduml)$'
        content = re.sub(pattern3, replace_block, content, flags=re.DOTALL | re.IGNORECASE | re.MULTILINE)
        
        # Pattern 4: PlantUML blocks in code fences
        pattern4 = r'```plantuml\s*\n(@startuml.*?@enduml)\s*\n```'
        content = re.sub(pattern4, replace_block, content, flags=re.DOTALL | re.IGNORECASE)
        
        return content

    def render_mermaid_blocks(self, content):
        """
        Detect and render Mermaid diagrams
        """
        def replace_mermaid(match):
            mermaid_code = match.group(1).strip()
            return mermaid_to_confluence_macro(mermaid_code)

        patterns = [
            r'```mermaid\s*\n(.*?)\n```',
            r'```mermaid\s+(.*?)```',
            r'~~~ *mermaid\s*\n(.*?)\n~~~'
        ]
        
        for pattern in patterns:
            content = re.sub(pattern, replace_mermaid, content, flags=re.DOTALL | re.IGNORECASE)
        
        return content

    def render_drawio_blocks(self, content):
        """
        Detect and render Draw.io diagrams
        """
        def replace_drawio(match):
            drawio_code = match.group(1).strip()
            return drawio_to_confluence_macro(drawio_code)

        patterns = [
            r'```drawio\s*\n(.*?)\n```',
            r'```draw\.io\s*\n(.*?)\n```',
            r'~~~ *drawio\s*\n(.*?)\n~~~'
        ]
        
        for pattern in patterns:
            content = re.sub(pattern, replace_drawio, content, flags=re.DOTALL | re.IGNORECASE)
        
        return content

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

    def convert_markdown_to_html(self, content):
        """Enhanced Markdown to HTML conversion"""
        html_lines = []
        lines = content.splitlines()
        i = 0
        in_code_block = False
        in_list = False
        list_type = None
        
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()
            
            # Handle code blocks
            if stripped.startswith('```') or stripped.startswith('~~~'):
                if in_code_block:
                    html_lines.append('</code></pre>')
                    in_code_block = False
                else:
                    lang = stripped[3:].strip() if len(stripped) > 3 else ''
                    if lang:
                        html_lines.append(f'<ac:structured-macro ac:name="code" ac:schema-version="1">')
                        html_lines.append(f'<ac:parameter ac:name="language">{lang}</ac:parameter>')
                        html_lines.append('<ac:plain-text-body><![CDATA[')
                    else:
                        html_lines.append('<pre><code>')
                    in_code_block = True
                i += 1
                continue
                
            if in_code_block:
                if stripped.startswith('```') or stripped.startswith('~~~'):
                    continue  # This will be handled above
                html_lines.append(html.escape(line))
                i += 1
                continue
            
            # Handle headers
            if stripped.startswith('#'):
                level = len(stripped) - len(stripped.lstrip('#'))
                text = stripped[level:].strip()
                html_lines.append(f'<h{level}>{html.escape(text)}</h{level}>')
            
            # Handle lists
            elif stripped.startswith(('* ', '- ', '+ ')):
                if not in_list:
                    html_lines.append('<ul>')
                    in_list = True
                    list_type = 'ul'
                elif list_type == 'ol':
                    html_lines.append('</ol><ul>')
                    list_type = 'ul'
                text = stripped[2:].strip()
                html_lines.append(f'<li>{self.process_inline_formatting(text)}</li>')
            
            elif re.match(r'^\d+\.\s', stripped):
                if not in_list:
                    html_lines.append('<ol>')
                    in_list = True
                    list_type = 'ol'
                elif list_type == 'ul':
                    html_lines.append('</ul><ol>')
                    list_type = 'ol'
                text = re.sub(r'^\d+\.\s', '', stripped)
                html_lines.append(f'<li>{self.process_inline_formatting(text)}</li>')
            
            else:
                # Close list if we were in one
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                    list_type = None
                
                # Handle tables
                if '|' in stripped and stripped.count('|') >= 2:
                    table_lines = [line]
                    i += 1
                    while i < len(lines) and '|' in lines[i].strip():
                        table_lines.append(lines[i])
                        i += 1
                    html_lines.append(self.convert_table(table_lines))
                    continue
                
                # Handle blockquotes
                elif stripped.startswith('>'):
                    quote_text = stripped[1:].strip()
                    html_lines.append(f'<blockquote><p>{self.process_inline_formatting(quote_text)}</p></blockquote>')
                
                # Handle horizontal rules
                elif stripped in ['---', '***', '___'] or re.match(r'^-{3,}$|^\*{3,}$|^_{3,}$', stripped):
                    html_lines.append('<hr/>')
                
                # Handle paragraphs
                elif stripped:
                    html_lines.append(f'<p>{self.process_inline_formatting(stripped)}</p>')
                
                else:
                    html_lines.append('<br/>')
            
            i += 1
        
        # Close any remaining lists or code blocks
        if in_list:
            html_lines.append(f'</{list_type}>')
        if in_code_block:
            html_lines.append(']]></ac:plain-text-body></ac:structured-macro>')
        
        return '\n'.join(html_lines)

    def process_inline_formatting(self, text):
        """Process inline markdown formatting"""
        # Handle existing HTML tags first (from previous processing)
        # Convert HTML tags to their text equivalents for re-processing
        text = re.sub(r'<strong>(.*?)</strong>', r'**\1**', text)
        text = re.sub(r'<code>(.*?)</code>', r'`\1`', text)
        text = re.sub(r'<em>(.*?)</em>', r'_\1_', text)
        
        # Bold
        text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', text)
        text = re.sub(r'__(.*?)__', r'<strong>\1</strong>', text)
        
        # Italic
        text = re.sub(r'\*(.*?)\*', r'<em>\1</em>', text)
        text = re.sub(r'_(.*?)_', r'<em>\1</em>', text)
        
        # Code
        text = re.sub(r'`(.*?)`', r'<code>\1</code>', text)
        
        # Links
        text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
        
        # Auto-links
        text = re.sub(r'<(https?://[^>]+)>', r'<a href="\1">\1</a>', text)
        
        return text  # Don't escape HTML since we want the tags to work

    def convert_table(self, table_lines):
        """Convert markdown table to HTML"""
        if not table_lines:
            return ''
        
        html = ['<table>']
        
        for i, line in enumerate(table_lines):
            cells = [cell.strip() for cell in line.split('|')[1:-1]]  # Remove empty cells from start/end
            
            # Skip separator line (usually second line with dashes)
            if i == 1 and all(re.match(r'^:?-+:?$', cell.strip()) for cell in cells):
                continue
            
            tag = 'th' if i == 0 else 'td'
            row_html = ''.join(f'<{tag}>{self.process_inline_formatting(cell)}</{tag}>' for cell in cells)
            html.append(f'<tr>{row_html}</tr>')
        
        html.append('</table>')
        return '\n'.join(html)

    def convert_adoc_to_html(self, content):
        """Enhanced AsciiDoc to HTML conversion"""
        html = []
        in_code = False
        in_table = False
        in_list = False
        in_plantuml = False
        table_headers = []
        lines = content.splitlines()
        i = 0
        
        while i < len(lines):
            line = lines[i]
            
            # Check for PlantUML placeholders - preserve them as-is
            if 'PLANTUML_IMAGE_PLACEHOLDER_' in line:
                html.append(line)
                i += 1
                continue
            
            # Check for PlantUML blocks first
            if line.strip().startswith('[plantuml') and i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                if next_line == '----' or next_line == '....':
                    # Skip PlantUML blocks entirely - they're handled by render_plantuml_blocks
                    in_plantuml = True
                    # Skip the [plantuml] line and delimiter line
                    i += 1
            elif in_plantuml and (line.strip() == '----' or line.strip() == '....'):
                # End of PlantUML block
                in_plantuml = False
            elif in_plantuml:
                # Skip PlantUML content (including @startuml/@enduml lines)
                pass
            elif line.strip().startswith('----') or line.strip().startswith('....'):
                # Only treat as code block if not in PlantUML context
                html.append('</code></pre>' if in_code else '<pre style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; border-left: 4px solid #007acc; overflow-x: auto;"><code>')
                in_code = not in_code
            elif in_code:
                html.append(line)
            elif line.strip().startswith('[cols=') and i + 1 < len(lines) and lines[i + 1].strip() == '|===':
                # Start of table
                in_table = True
                html.append('<table border="1" style="border-collapse: collapse; width: 100%; margin: 15px 0;">')
                i += 1  # Skip the |=== line
            elif in_table and line.strip() == '|===':
                # End of table
                html.append('</table>')
                in_table = False
                table_headers = []
            elif in_table:
                if line.strip().startswith('|'):
                    # Table row
                    cells = [cell.strip() for cell in line.split('|')[1:]]  # Skip first empty element
                    if cells:
                        if not table_headers:
                            # First row is headers
                            table_headers = cells
                            html.append('<tr>')
                            for cell in cells:
                                html.append(f'<th style="padding: 12px; background-color: #f5f5f5; border: 1px solid #ddd; text-align: left;">{self.process_adoc_formatting(cell)}</th>')
                            html.append('</tr>')
                        else:
                            # Data row
                            html.append('<tr>')
                            for cell in cells:
                                html.append(f'<td style="padding: 12px; border: 1px solid #ddd;">{self.process_adoc_formatting(cell)}</td>')
                            html.append('</tr>')
            elif line.startswith('= '): 
                html.append(f"<h1 style='margin: 20px 0 15px 0; color: #333;'>{self.process_adoc_formatting(line[2:].strip())}</h1>")
            elif line.startswith('== '): 
                html.append(f"<h2 style='margin: 18px 0 12px 0; color: #444;'>{self.process_adoc_formatting(line[3:].strip())}</h2>")
            elif line.startswith('=== '): 
                html.append(f"<h3 style='margin: 16px 0 10px 0; color: #555;'>{self.process_adoc_formatting(line[4:].strip())}</h3>")
            elif line.startswith('==== '): 
                html.append(f"<h4 style='margin: 14px 0 8px 0; color: #666;'>{self.process_adoc_formatting(line[5:].strip())}</h4>")
            elif line.startswith('===== '): 
                html.append(f"<h5 style='margin: 12px 0 6px 0; color: #777;'>{self.process_adoc_formatting(line[6:].strip())}</h5>")
            elif line.strip().startswith(('* ', '- ', '. ')):
                if not in_list:
                    html.append('<ul style="margin: 10px 0; padding-left: 20px;">')
                    in_list = True
                list_content = line.strip()[2:] if line.strip().startswith(('* ', '- ')) else line.strip()[2:]
                html.append(f"<li style='margin: 5px 0;'>{self.process_adoc_formatting(list_content)}</li>")
            elif in_list and not line.strip().startswith(('* ', '- ', '. ')) and line.strip():
                # End of list
                html.append('</ul>')
                in_list = False
                html.append(f"<p style='margin: 10px 0; line-height: 1.6;'>{self.process_adoc_formatting(line)}</p>")
            elif line.strip() and not line.strip().startswith(':') and not line.strip().startswith('['):
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append(f"<p style='margin: 10px 0; line-height: 1.6;'>{self.process_adoc_formatting(line)}</p>")
            elif not line.strip():
                if in_list:
                    html.append('</ul>')
                    in_list = False
                html.append('<div style="margin: 10px 0;"></div>')
            
            i += 1
            
        if in_code:
            html.append('</code></pre>')
        if in_table:
            html.append('</table>')
        if in_list:
            html.append('</ul>')
            
        return '\n'.join(html)

    def process_adoc_formatting(self, text):
        """Process inline AsciiDoc formatting - avoid processing PlantUML placeholders"""
        # Skip processing if this contains a PlantUML placeholder
        if 'PLANTUML_IMAGE_PLACEHOLDER_' in text:
            return text
        
        # Handle existing HTML tags first (from previous processing)
        # Convert HTML tags to their text equivalents for re-processing
        text = re.sub(r'<strong>(.*?)</strong>', r'**\1**', text)
        text = re.sub(r'<code>(.*?)</code>', r'`\1`', text)
        text = re.sub(r'<em>(.*?)</em>', r'_\1_', text)
        
        # Remove asterisks that are not part of formatting (single asterisks)
        # First, handle proper bold formatting (double asterisks)
        text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
        
        # Remove any remaining single asterisks that are not formatting
        text = re.sub(r'(?<!\*)\*(?!\*)', '', text)
        
        # Italic
        text = re.sub(r'_([^_]+)_', r'<em>\1</em>', text)
        
        # Monospace
        text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
        
        # Links - but avoid processing PlantUML URLs
        if 'plantuml.com' not in text:
            text = re.sub(r'link:([^\[]+)\[([^\]]+)\]', r'<a href="\1">\2</a>', text)
            text = re.sub(r'https?://[^\s\[\]]+', lambda m: f'<a href="{m.group(0)}">{m.group(0)}</a>', text)
        
        return text  # Don't escape HTML since we want the tags to work

    def convert_to_html(self, content, ext):
        """Enhanced content conversion with diagram support"""
        # First, render diagrams to placeholders
        content = self.render_all_diagrams(content, Path('.'))
        
        # Then convert to HTML based on file type
        if ext == '.adoc':
            html_content = self.convert_adoc_to_html(content)
        elif ext == '.md':
            html_content = self.convert_markdown_to_html(content)
        else:
            # For other formats, wrap in code block
            escaped_content = html.escape(content)
            html_content = f'<ac:structured-macro ac:name="code" ac:schema-version="1"><ac:plain-text-body><![CDATA[{escaped_content}]]></ac:plain-text-body></ac:structured-macro>'
        
        # Finally, replace PlantUML placeholders with actual image tags
        html_content = self.replace_plantuml_placeholders(html_content)
        
        return html_content

    def replace_plantuml_placeholders(self, content):
        """Replace PlantUML placeholders with actual Confluence image tags"""
        def replace_placeholder(match):
            url = match.group(1)
            return f'<ac:image><ri:url ri:value="{url}" /></ac:image>'
        
        # Updated pattern to handle underscores and hyphens in PlantUML encoded URLs
        pattern = r'PLANTUML_IMAGE_PLACEHOLDER_(https://www\.plantuml\.com/plantuml/png/[A-Za-z0-9_-]+)_END_PLACEHOLDER'
        return re.sub(pattern, replace_placeholder, content)

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
        
        # Check microservices
        for svc in MICROSERVICES:
            folder = Path(svc, 'documentation')
            print(f"Checking {svc}: {folder}")
            if not folder.exists():
                print(f"  Folder doesn't exist: {folder}")
                continue
            doc_files = [str(p) for p in folder.rglob('*') if p.suffix in ['.md', '.adoc']]
            print(f"  Found {len(doc_files)} files: {doc_files}")
            all_docs[svc] = doc_files
        
        # Check for release notes
        release_folder = Path('release-notes')
        if release_folder.exists():
            release_files = [str(p) for p in release_folder.rglob('*') if p.suffix in ['.md', '.adoc']]
            if release_files:
                print(f"Checking release-notes: {release_folder}")
                print(f"  Found {len(release_files)} release note files: {release_files}")
                all_docs['release-notes'] = release_files
        
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

        # Load existing hashes to track changes
        hashes = self.load_hashes()
        updated_hashes = hashes.copy()
        files_updated = 0
        files_skipped = 0
        total_files = sum(len(files) for files in docs.values())

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
            
            if svc == 'release-notes':
                # Handle release notes specially
                release_has_changes = any(self.has_file_changed(f, hashes) for f in files)
                if not release_has_changes:
                    print("  No changes detected in release notes, skipping...")
                    files_skipped += len(files)
                    continue
                
                print("  Release notes have changed, updating...")
                for f in files:
                    fname = os.path.basename(f)
                    print(f"  Processing file: {fname}")
                    content = self.read_file(f)
                    if content:
                        title = "Release Notes"
                        html = self.convert_to_html(content, Path(f).suffix)
                        page_content = f"<h3>{title}</h3><p>File: {fname}</p><hr/>{html}"
                        
                        page = self.find_existing_page(title)
                        if page:
                            print(f"  Updating release notes page: {title}")
                            self.update_page(page['id'], title, page_content, page['version']['number'], parent_id)
                        else:
                            print(f"  Creating release notes page: {title}")
                            self.create_page(title, page_content, parent_id)
                        
                        # Update hash
                        updated_hashes[f] = self.get_file_hash(f)
                        files_updated += 1
                continue
            
            # Handle regular service documentation
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
                
                # Check if file has changed
                if not self.has_file_changed(f, hashes):
                    print(f"  Skipping file: {fname} -> {title} (NO CHANGES)")
                    files_skipped += 1
                    continue
                
                print(f"  Processing file: {fname} -> {title} (CHANGED)")
                content = self.read_file(f)
                if not content:
                    print(f"  Could not read file: {f}")
                    continue

                # Enhanced diagram rendering
                html = self.convert_to_html(content, Path(f).suffix)
                page = self.find_existing_page(title)
                page_content = f"<h3>{title}</h3><p>File: {fname}</p><hr/>{html}"
                
                if page:
                    print(f"    Updating existing page: {title}")
                    result = self.update_page(page['id'], title, page_content, page['version']['number'], svc_id)
                    print(f"    Update result: {result}")
                else:
                    print(f"    Creating new page: {title}")
                    page_id = self.create_page(title, page_content, svc_id)
                    print(f"    Create result: {page_id}")

                # Update hash for this file
                updated_hashes[f] = self.get_file_hash(f)
                files_updated += 1

        # Save updated hashes
        self.save_hashes(updated_hashes)

        print(f"\n=== Upload Summary ===")
        print(f"Total files processed: {total_files}")
        print(f"Files updated: {files_updated}")
        print(f"Files skipped (no changes): {files_skipped}")
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