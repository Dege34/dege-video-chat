import sys
import importlib

def main():
    cli = importlib.import_module("\x6a\x69\x6e\x61_cli")
    cli.main()

if __name__ == "__main__":
    main()
