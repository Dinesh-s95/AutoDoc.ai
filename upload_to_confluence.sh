#!/bin/bash

# Confluence Documentation Uploader Shell Script
# This script runs the Python uploader for documentation files

echo "🚀 Confluence Documentation Uploader"
echo "====================================="

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not installed."
    echo "Please install Python 3 and try again."
    exit 1
fi

# Check if requests library is available
if ! python3 -c "import requests" 2>/dev/null; then
    echo "📦 Installing required Python package: requests"
    pip3 install requests
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install requests. Please install manually:"
        echo "   pip3 install requests"
        exit 1
    fi
fi

# Run the Python uploader
echo "🐍 Running Python uploader..."
python3 confluence_uploader.py

# Check exit status
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Upload completed successfully!"
else
    echo ""
    echo "❌ Upload failed. Check the output above for details."
fi
