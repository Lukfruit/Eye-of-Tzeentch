#!/usr/bin/env python3
"""
Generate Feature-Based Codebase Maps with Dependency Information
"""

import os
import re
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from typing import Dict, List, Set, Tuple

class SwiftFile:
    def __init__(self, path: Path, relative_path: Path):
        self.path = path
        self.relative_path = relative_path
        self.imports = set()
        self.classes = []
        self.protocols = []
        self.structs = []
        self.enums = []
        self.dependencies = set()  # What this file depends on
        self.api_surface = ""
        
    def parse(self, content: str):
        """Extract API surface and dependencies"""
        self.api_surface = extract_api_surface(content)
        self.imports = extract_imports(content)
        self.dependencies = extract_dependencies(content)
        
        # Extract type names for dependency tracking
        for match in re.finditer(r'^(class|struct|enum|protocol)\s+(\w+)', content, re.MULTILINE):
            type_kind, type_name = match.groups()
            if type_kind == 'class':
                self.classes.append(type_name)
            elif type_kind == 'struct':
                self.structs.append(type_name)
            elif type_kind == 'enum':
                self.enums.append(type_name)
            elif type_kind == 'protocol':
                self.protocols.append(type_name)

def extract_api_surface(swift_content: str) -> str:
    """Extract API surface (same as before)"""
    lines = swift_content.split('\n')
    output = []
    in_type = False
    brace_depth = 0
    current_signature = []
    
    for line in lines:
        stripped = line.strip()
        
        if stripped.startswith('import '):
            output.append(line)
            continue
        
        if re.match(r'^(class|struct|enum|protocol|extension)\s+', stripped):
            in_type = True
            brace_depth = 0
            output.append(line)
            continue
        
        if not in_type:
            continue
        
        brace_depth += line.count('{')
        brace_depth -= line.count('}')
        
        if brace_depth == 0 and '}' in line:
            output.append(line)
            output.append('')
            in_type = False
            continue
        
        if re.match(r'^\s*(@\w+\s+)?(var|let)\s+', stripped):
            clean_line = re.sub(r'\s*\{[^}]*\}\s*$', '', line)
            output.append(clean_line)
            continue
        
        if re.match(r'^\s*(public|private|internal|fileprivate|open)?\s*(static|class)?\s*(func|init|subscript)', stripped):
            current_signature = [line]
            if '{' not in line and line.rstrip().endswith(')'):
                output.append(line)
                current_signature = []
            continue
        
        if current_signature:
            current_signature.append(line)
            if '{' in line or line.rstrip().endswith(')'):
                full_signature = '\n'.join(current_signature)
                full_signature = re.sub(r'\s*\{.*$', '', full_signature, flags=re.DOTALL)
                output.append(full_signature)
                current_signature = []
            continue
    
    return '\n'.join(output)

def extract_imports(content: str) -> Set[str]:
    """Extract import statements"""
    imports = set()
    for line in content.split('\n'):
        if line.strip().startswith('import '):
            imports.add(line.strip())
    return imports

def extract_dependencies(content: str) -> Set[str]:
    """Extract dependencies: types used, singletons, protocol conformance"""
    dependencies = set()
    
    # Swift keywords and built-in types to ignore
    ignore_set = {
        # Keywords
        'true', 'false', 'nil', 'self', 'super', 'return', 'let', 'var', 'func',
        'class', 'struct', 'enum', 'protocol', 'extension', 'import', 'if', 'else',
        'for', 'while', 'switch', 'case', 'break', 'continue', 'some', 'any', 'try',
        'catch', 'throw', 'throws', 'private', 'public', 'internal', 'fileprivate',
        'open', 'static', 'final', 'init', 'deinit', 'inout', 'guard', 'defer',
        
        # Built-in types
        'Int', 'String', 'Bool', 'Double', 'Float', 'Character', 'Date', 'UUID', 
        'Data', 'URL', 'Error', 'Array', 'Dictionary', 'Set', 'Optional', 'Result',
        'Range', 'ClosedRange', 'Void', 'Never', 'AnyObject', 'Any',
        
        # SwiftUI/UIKit common types
        'View', 'some', 'Color', 'CGFloat', 'CGSize', 'CGRect', 'CGPoint',
        'UIImage', 'NSObject', 'Binding', 'State', 'Published', 'StateObject',
        'ObservableObject', 'EnvironmentObject', 'Environment',
        
        # Foundation common
        'TimeInterval', 'IndexSet', 'Identifiable', 'Codable', 'Decodable', 'Encodable',
        'Hashable', 'Equatable', 'Comparable',
        
        # Common patterns
        'Void', 'Context', 'Self', 'Type'
    }
    
    # 1. Find singleton access patterns (.shared, .default, .main)
    for match in re.finditer(r'(\w+)\.(shared|default|main)(?!\w)', content):
        class_name = match.group(1)
        # Skip if it's a generic name or in ignore list
        if class_name not in ignore_set and not class_name[0].islower():
            dependencies.add(f"{class_name} (singleton)")
    
    # 2. Find protocol conformance (: ProtocolName)
    # Match "class X: Y" or "struct X: Y" patterns
    for match in re.finditer(r'(?:class|struct|enum)\s+\w+\s*:\s*(\w+)', content):
        protocol_name = match.group(1)
        if protocol_name not in ignore_set and 'Protocol' in protocol_name:
            dependencies.add(f"{protocol_name} (protocol)")
    
    # 3. Find protocol types in parameters and properties
    # Match ": ProtocolType" patterns
    for match in re.finditer(r':\s*([A-Z]\w*Protocol)(?:\?|!)?(?:\s|,|\)|=)', content):
        protocol_name = match.group(1)
        if protocol_name not in ignore_set:
            dependencies.add(protocol_name)
    
    # 4. Find custom types in property declarations
    # Match "var name: CustomType" or "let name: CustomType"
    for match in re.finditer(r'(?:var|let)\s+\w+\s*:\s*([A-Z]\w+)(?:\?|!)?(?:\s|=|,|\))', content):
        type_name = match.group(1)
        if type_name not in ignore_set:
            dependencies.add(type_name)
    
    # 5. Find custom types in function parameters
    # Match "func x(param: CustomType)"
    for match in re.finditer(r'func\s+\w+\s*\([^)]*:\s*([A-Z]\w+)(?:\?|!)?', content):
        type_name = match.group(1)
        if type_name not in ignore_set:
            dependencies.add(type_name)
    
    # 6. Find initializer parameters
    # Match "init(param: CustomType)"
    for match in re.finditer(r'init\s*\([^)]*:\s*([A-Z]\w+)(?:\?|!)?', content):
        type_name = match.group(1)
        if type_name not in ignore_set:
            dependencies.add(type_name)
    
    return dependencies

def categorize_by_feature(file: SwiftFile) -> str:
    """Determine which feature this file belongs to"""
    path_str = str(file.relative_path).lower()

    # Dev/preview/deprecated files — check first to avoid mismatches below
    if any(x in path_str for x in ['preview content', 'deprecated?', 'deprecated']):
        return 'DevOnly'

    # Feature-based folders
    if 'addwordview' in path_str or 'addword' in path_str:
        return 'AddWord'
    elif 'readingcomprehension' in path_str or 'reading' in path_str:
        return 'Reading'
    elif 'persistence' in path_str:
        return 'Persistence'
    elif 'translationservice' in path_str or 'translation' in path_str:
        return 'Translation'
    elif 'lessonview' in path_str or 'lesson' in path_str:
        return 'Lesson'
    elif 'listview' in path_str:
        return 'Vocabulary'
    elif 'linguawebview' in path_str:
        return 'LinguaWeb'
    elif 'curriculum' in path_str:
        return 'Curriculum'
    elif 'sync' in path_str:
        return 'Sync'

    # Service files
    elif 'srsservice' in path_str or 'srs' in path_str or 'focusvocabulary' in path_str:
        return 'SRS'
    elif 'vocabulary' in path_str or 'word struct' in path_str:
        return 'Vocabulary'
    elif 'dictionaryservice' in path_str or 'dictionary' in path_str:
        return 'Dictionary'
    elif 'textgeneration' in path_str:
        return 'TextGeneration'

    # Shared/infrastructure
    elif any(name in path_str for name in ['database', 'repository', 'cache', 'persistence']):
        return 'Shared'
    elif 'protocol' in path_str:
        return 'Shared'
    elif 'utility' in path_str or 'utilities' in path_str:
        return 'Shared'

    # Root files - check by name
    elif file.relative_path.name in ['Word.swift', 'AppState.swift', 'GeminiAPIClient.swift',
                                      'WordDetectorService.swift', 'APIKeys.swift']:
        return 'Shared'

    # App-level infrastructure
    elif file.relative_path.name in ['AppTheme.swift', 'UserAccount.swift', 'XPConfig.swift',
                                      'ChracterExtensions.swift', 'LinguaWebApp.swift',
                                      'GeminiProvider.swift', 'GeminiNLPService.swift']:
        return 'App'

    return 'Other'

def analyze_shared_usage(files_by_feature: Dict[str, List[SwiftFile]]) -> Dict[str, Dict]:
    """Analyze which shared components are used by which features"""
    shared_usage = defaultdict(lambda: {'used_by': set(), 'type': '', 'location': ''})
    
    shared_files = files_by_feature.get('Shared', [])
    
    for shared_file in shared_files:
        # Get all type names from this file
        all_types = shared_file.classes + shared_file.structs + shared_file.enums + shared_file.protocols
        
        for type_name in all_types:
            shared_usage[type_name]['location'] = str(shared_file.relative_path)
            
            # Determine type
            if type_name in shared_file.classes:
                shared_usage[type_name]['type'] = 'Class'
            elif type_name in shared_file.structs:
                shared_usage[type_name]['type'] = 'Struct'
            elif type_name in shared_file.protocols:
                shared_usage[type_name]['type'] = 'Protocol'
            elif type_name in shared_file.enums:
                shared_usage[type_name]['type'] = 'Enum'
    
    # Find which features use which shared components
    for feature, files in files_by_feature.items():
        if feature == 'Shared':
            continue
        
        for file in files:
            for dep in file.dependencies:
                # Remove qualifiers like (singleton), (protocol)
                clean_dep = re.sub(r'\s*\(.*\)$', '', dep)
                if clean_dep in shared_usage:
                    shared_usage[clean_dep]['used_by'].add(feature)
    
    return shared_usage

def generate_feature_map(feature: str, files: List[SwiftFile], 
                         files_by_feature: Dict[str, List[SwiftFile]],
                         shared_usage: Dict) -> str:
    """Generate a feature map with dependencies"""
    output = []
    
    output.append(f"# Feature: {feature}\n")
    output.append(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    output.append(f"**Files in this feature:** {len(files)}\n\n")
    
    # Overview
    output.append("## Overview\n")
    output.append(get_feature_description(feature))
    output.append("\n")
    
    # Dependencies
    output.append("## Dependencies\n\n")
    
    # Collect all dependencies from files in this feature
    all_deps = set()
    for file in files:
        all_deps.update(file.dependencies)
    
    # Separate shared vs other features
    shared_deps = set()
    feature_deps = set()
    
    for dep in all_deps:
        clean_dep = re.sub(r'\s*\(.*\)$', '', dep)
        if clean_dep in shared_usage:
            shared_deps.add(dep)
        else:
            # Check if it's from another feature
            for other_feature, other_files in files_by_feature.items():
                if other_feature == feature or other_feature == 'Shared':
                    continue
                for other_file in other_files:
                    if clean_dep in (other_file.classes + other_file.structs + 
                                   other_file.enums + other_file.protocols):
                        feature_deps.add(f"{dep} (from {other_feature})")
    
    if shared_deps:
        output.append("### Uses Shared Components:\n")
        for dep in sorted(shared_deps):
            clean_dep = re.sub(r'\s*\(.*\)$', '', dep)
            if clean_dep in shared_usage:
                location = shared_usage[clean_dep]['location']
                type_kind = shared_usage[clean_dep]['type']
                output.append(f"- **{dep}** ({type_kind}) - `{location}`\n")
        output.append("\n")
    
    if feature_deps:
        output.append("### Uses Other Features:\n")
        for dep in sorted(feature_deps):
            output.append(f"- {dep}\n")
        output.append("\n")
    
    # Used by
    used_by_features = set()
    for file in files:
        for type_name in file.classes + file.structs + file.enums + file.protocols:
            for other_feature, other_files in files_by_feature.items():
                if other_feature == feature:
                    continue
                for other_file in other_files:
                    if type_name in other_file.dependencies:
                        used_by_features.add(other_feature)
    
    if used_by_features:
        output.append("### Used By:\n")
        for other_feature in sorted(used_by_features):
            output.append(f"- {other_feature} feature\n")
        output.append("\n")
    
    output.append("---\n\n")
    
    # Components
    output.append("## Components\n\n")
    
    for file in files:
        output.append(f"### {file.relative_path}\n\n")
        
        # Show what this specific file depends on
        if file.dependencies:
            output.append("**Dependencies:**\n")
            for dep in sorted(file.dependencies):
                output.append(f"- {dep}\n")
            output.append("\n")
        
        output.append("```swift\n")
        output.append(file.api_surface)
        output.append("\n```\n\n")
        output.append("---\n\n")
    
    return ''.join(output)

def generate_shared_components_map(shared_usage: Dict) -> str:
    """Generate shared components analysis"""
    output = []
    
    output.append("# Shared Components\n")
    output.append(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
    output.append("These components are used across multiple features.\n")
    output.append("**Warning:** Changes to these files have wide-reaching impact!\n\n")
    output.append("---\n\n")
    
    # Sort by number of features using it (most used first)
    sorted_components = sorted(
        shared_usage.items(),
        key=lambda x: len(x[1]['used_by']),
        reverse=True
    )
    
    output.append("## High-Impact Shared Code\n\n")
    
    for component_name, info in sorted_components:
        if not info['used_by']:  # Skip if not used by anyone
            continue
        
        output.append(f"### {component_name}\n")
        output.append(f"**Type:** {info['type']}\n")
        output.append(f"**Location:** `{info['location']}`\n")
        output.append(f"**Used by {len(info['used_by'])} features:**\n")
        for feature in sorted(info['used_by']):
            output.append(f"- {feature}\n")
        output.append("\n")
    
    return ''.join(output)

def get_feature_description(feature: str) -> str:
    """Get a brief description of what each feature does"""
    descriptions = {
        'AddWord': 'Add new words to vocabulary through manual entry, OCR, or sentence mining.',
        'Reading': 'AI-generated reading comprehension texts at appropriate difficulty levels.',
        'Translation': 'Korean text analysis and translation with morphological component breakdown.',
        'Lesson': 'Main learning interface where users practice vocabulary in sentences.',
        'Vocabulary': 'Browse, search, and manage user vocabulary with focus queue integration.',
        'Curriculum': 'Curriculum content, adaptive grammar, and tutor-session workflows.',
        'Sync': 'Cross-device synchronization, reconciliation, and remote transports.',
        'Persistence': 'Local database access and application caches.',
        'SRS': 'Spaced repetition system with XP/levels and focus queue management.',
        'Dictionary': 'Offline Korean-English dictionary lookup with 10,000+ NIKL entries.',
        'TextGeneration': 'AI-powered Korean text generation with validation and caching.',
        'LinguaWeb': 'Interactive word graph visualization with SpriteKit-based node/edge rendering and gesture handling.',
        'App': 'App-level infrastructure: entry point, theming, user account, LLM provider implementations, and utilities.',
        'DevOnly': 'Preview visualizations and deprecated/test files. Not part of production app.',
        'Other': 'Supporting components and utilities.'
    }
    return descriptions.get(feature, 'Feature components.')

def generate_index(files_by_feature: Dict[str, List[SwiftFile]]) -> str:
    """Generate index/guide"""
    output = []
    
    output.append("# LinguaWeb Codebase Map - Index\n")
    output.append(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
    
    total_files = sum(len(files) for files in files_by_feature.values())
    output.append(f"**Total files:** {total_files}\n\n")
    
    output.append("## Available Feature Maps\n\n")
    
    for feature in sorted(files_by_feature.keys()):
        if feature in ('Shared', 'DevOnly'):
            continue
        file_count = len(files_by_feature[feature])
        output.append(f"- **Feature_{feature}.md** ({file_count} files) - {get_feature_description(feature)}\n")
    
    output.append(f"\n- **Shared_Components.md** - High-impact shared code analysis\n\n")
    
    output.append("## Quick Guide\n\n")
    output.append("**Working on a feature?** Upload the relevant feature map:\n")
    output.append("- Adding words → `Feature_AddWord.md`\n")
    output.append("- Reading texts → `Feature_Reading.md`\n")
    output.append("- Translation system → `Feature_Translation.md`\n")
    output.append("- Main lesson UI → `Feature_Lesson.md`\n")
    output.append("- Vocabulary management → `Feature_Vocabulary.md`\n")
    output.append("- Curriculum and tutor workflows → `Feature_Curriculum.md`\n")
    output.append("- Cross-device sync → `Feature_Sync.md`\n")
    output.append("- Local persistence and caches → `Feature_Persistence.md`\n")
    output.append("- SRS/Focus queue → `Feature_SRS.md`\n")
    output.append("- Word graph view → `Feature_LinguaWeb.md`\n")
    output.append("- App infrastructure → `Feature_App.md`\n\n")
    
    output.append("**Changing shared code?** Upload:\n")
    output.append("- `Shared_Components.md` - See impact analysis\n")
    output.append("- Relevant feature map(s) - See how it's used\n\n")
    
    output.append("**Building new feature?** Upload:\n")
    output.append("- Related feature map (where it integrates)\n")
    output.append("- `Shared_Components.md` (see what you can use)\n")
    
    return ''.join(output)

def main(source_dir: str, output_dir: str):
    """Main generation function"""
    print("🔍 Scanning Swift files...")
    
    source_path = Path(source_dir)
    swift_files = []
    
    for swift_file_path in source_path.rglob('*.swift'):
        # Skip certain directories
        if any(skip in str(swift_file_path) for skip in ['.build', 'Tests', 'Pods']):
            continue
        
        try:
            with open(swift_file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            file_obj = SwiftFile(swift_file_path, swift_file_path.relative_to(source_path))
            file_obj.parse(content)
            swift_files.append(file_obj)
            
        except Exception as e:
            print(f"⚠️  Error processing {swift_file_path}: {e}")
    
    print(f"✅ Found {len(swift_files)} Swift files\n")
    
    # Categorize by feature
    print("📁 Categorizing by feature...")
    files_by_feature = defaultdict(list)
    
    for file in swift_files:
        feature = categorize_by_feature(file)
        files_by_feature[feature].append(file)
    
    for feature, files in sorted(files_by_feature.items()):
        print(f"   {feature}: {len(files)} files")
    
    print("\n🔗 Analyzing dependencies...")
    shared_usage = analyze_shared_usage(files_by_feature)
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"\n📝 Generating feature maps...")
    
    # Generate feature maps
    for feature, files in sorted(files_by_feature.items()):
        if feature == 'Shared':
            continue
        
        output_file = os.path.join(output_dir, f"Feature_{feature}.md")
        content = generate_feature_map(feature, files, files_by_feature, shared_usage)
        
        with open(output_file, 'w') as f:
            f.write(content)
        
        print(f"   ✅ {output_file}")
    
    # Generate shared components map
    shared_file = os.path.join(output_dir, "Shared_Components.md")
    shared_content = generate_shared_components_map(shared_usage)
    
    with open(shared_file, 'w') as f:
        f.write(shared_content)
    
    print(f"   ✅ {shared_file}")
    
    # Generate index
    index_file = os.path.join(output_dir, "MAP_INDEX.md")
    index_content = generate_index(files_by_feature)
    
    with open(index_file, 'w') as f:
        f.write(index_content)
    
    print(f"   ✅ {index_file}")
    
    print(f"\n✨ Done! Check {output_dir}/ for your codebase maps.")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python3 generate_feature_maps.py <source_directory> [output_directory]")
        print("Example: python3 generate_feature_maps.py ./LinguaWeb ./Codebase_Map")
        sys.exit(1)
    
    source_dir = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "./Codebase_Map"
    
    if not os.path.isdir(source_dir):
        print(f"❌ Error: Directory not found: {source_dir}")
        sys.exit(1)
    
    main(source_dir, output_dir)
