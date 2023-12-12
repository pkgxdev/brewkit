import requests

def get_website_content(url):
    response = requests.get(url)
    return response.text

def main():
    content = get_website_content("https://example.com")
    print(content)
