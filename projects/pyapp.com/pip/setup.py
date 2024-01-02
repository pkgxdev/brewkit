from setuptools import setup, find_packages

setup(
    name='myapp',
    version='1.0.0',
    packages=find_packages(),
    install_requires=[
        'requests',
    ],
    entry_points={
        'console_scripts': [
            'myapp=myapp.main:main',
        ],
    },
)
